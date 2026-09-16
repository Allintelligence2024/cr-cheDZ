#!/usr/bin/env node
// G4 (audit 2026-09) : révocation GLOBALE des principaux — JWT d'accès en vol,
// rôles, memberships, état de compte. L'audit notait qu'un changement de rôle ou
// de statut restait invisible jusqu'à l'expiration du token (15 min) : les
// révisions partielles (G1 refresh, H2b/H2c re-contrôles d'endpoint) laissaient
// la voie « access token en vol » ouverte.
//
// Contrat testé ici (HTTP réel + PostgreSQL réel, aucune assertion sur du sleep) :
//  - tout changement d'état de révocation (statut/super-adminité/mot de passe/
//    suppression du compte, membership inactive/rôle principal, rôle additionnel
//    ajouté/retiré) invalide IMMÉDIATEMENT les access tokens en vol, à TOUTES
//    les routes, par dépassement d'un compteur d'époque (users.token_epoch)
//    revérifié au garde d'entrée ;
//  - le rétablissement (reactivation, re-grant) force de même une reconnexion ;
//  - login/refresh/réémission restent cohérents : le nouveau token porte
//    l'époque courante et fonctionne ;
//  - compatibilité de déploiement progressif : un token sans claim epoch (émis
//    par une instance précédente) vaut époque 0 et reste utilisable tant
//    qu'aucune révocation ne l'a frappé ;
//  - la voie collecteur métriques (sans sub utilisateur) n'est PAS affectée.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
await db.connect();
let app, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.message}`); }
}

// ── HS256 JWT manuel (sans dépendance) pour le scénario de compatibilité ──
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signHS256(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const jwtSecret = () => process.env.JWT_SECRET || 'dev_jwt_secret_change_in_prod_minimum_32_chars';

async function userRow(id) {
  return (await db.query('SELECT token_epoch, status, is_super_admin, deleted_at FROM users WHERE id=$1', [id])).rows[0];
}

try {
  await ensureAppRole(db);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const password = 'G4-Synthetic-Only!';
  const hash = await bcrypt.hash(password, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G4','31') RETURNING id", [randomUUID()])).rows[0].id;

  async function login(email, pw = password) {
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
    const body = res.status === 200 ? await res.json() : null;
    assert.ok(body, `login attendu 200, reçu ${res.status}`);
    return body;
  }
  async function mkUser({ superAdmin = false, role = null } = {}) {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query(
      "INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'G4','Synthetic',$2,'active',$3) RETURNING id",
      [email, hash, superAdmin])).rows[0].id;
    if (role) {
      await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3", [org, id, role]);
    }
    const body = await login(email);
    return { id, email, access: body.access_token, refresh: body.refresh_token };
  }
  const req = (path, token, method = 'GET', body) => fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });

  const director = await mkUser({ role: 'director' });
  const staff = await mkUser({ role: 'educator' });
  const parent = await mkUser({ role: 'parent_primary' });
  const admin = await mkUser({ superAdmin: true });

  // ── structure de la migration 062 ───────────────────────────────────────
  await check('users.token_epoch existe (bigint NOT NULL DEFAULT 0)', async () => {
    const c = (await db.query(`SELECT data_type, column_default FROM information_schema.columns WHERE table_name='users' AND column_name='token_epoch'`)).rows[0];
    assert.ok(c, 'colonne absente');
    assert.equal(c.data_type, 'bigint');
    assert.match(c.column_default, /0/);
  });
  await check('déclencheurs de révocation branchés (users, memberships, role_assignments)', async () => {
    const t = (await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_g4_users_epoch','trg_g4_memberships_epoch','trg_g4_role_assignments_epoch') ORDER BY tgname`)).rows.map(r => r.tgname);
    assert.deepEqual(t, ['trg_g4_memberships_epoch', 'trg_g4_role_assignments_epoch', 'trg_g4_users_epoch']);
  });
  await check('migration idempotente (rejeu du fichier sans erreur)', async () => {
    const sql = readFileSync(new URL('../../infrastructure/database/migrations/062_principal_token_epoch.sql', import.meta.url), 'utf8');
    await db.query(sql); // doit passer une 2e fois (CREATE OR REPLACE / DROP IF EXISTS / IF NOT EXISTS)
  });

  // ── tokens frais : claim epoch présent et aligné ────────────────────────
  await check('le token signé à login porte epoch = users.token_epoch', async () => {
    const row = await userRow(director.id);
    assert.equal(Number(claims(director.access).epoch), Number(row.token_epoch));
  });
  await check('aucune révocation => les tokens en vol restent valides', async () => {
    assert.equal((await req('/me', director.access)).status, 200);
    assert.equal((await req('/me', staff.access)).status, 200);
  });

  // ── révocation de membership : 401 immédiat, toutes routes ─────────────
  await check('membership inactive (SQL ops) => access token en vol révoqué (401)', async () => {
    assert.equal((await req('/rooms', director.access)).status, 200); // préalable : route accessible avec le token
    await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [org, director.id]);
    const after = await req('/me', director.access);
    assert.equal(after.status, 401, `attendu 401 global, reçu ${after.status}`);
    assert.equal((await req('/rooms', director.access)).status, 401);
    const row = await userRow(director.id);
    assert.ok(Number(row.token_epoch) > 0, 'epoch incrémenté par le déclencheur');
    await db.query('UPDATE memberships SET is_active=true WHERE organization_id=$1 AND user_id=$2', [org, director.id]);
  });
  await check('rétablissement (reactivation) => reconnexion forcée puis accès rétabli', async () => {
    assert.equal((await req('/me', director.access)).status, 401); // l'ancien token reste mort (re-grant = bump aussi)
    const body = await login(director.email);
    director.access = body.access_token;
    assert.equal((await req('/me', director.access)).status, 200);
  });

  // ── mot de passe changé : ancien token mort + refresh révoqué ───────────
  await check('change-password API => ancien access 401, refresh révoqué, nouveau login OK', async () => {
    const r = await req('/auth/change-password', staff.access, 'POST', { old_password: password, new_password: 'G4-Second-Password!' });
    assert.equal(r.status, 204, await r.text());
    assert.equal((await req('/me', staff.access)).status, 401);
    const rr = await req('/auth/refresh', null, 'POST', { refresh_token: staff.refresh });
    assert.ok(rr.status === 401 || rr.status === 403, `refresh révoqué attendu, reçu ${rr.status}`);
    staff.access = (await login(staff.email, 'G4-Second-Password!')).access_token;
    assert.equal((await req('/me', staff.access)).status, 200);
  });

  // ── rôles additionnels via l'API (chemin directeur réel) ────────────────
  await check('grant de rôle via API => cible déconnectée, acteur épargné, relogin porteur du rôle', async () => {
    const roleId = (await db.query("SELECT id FROM roles WHERE slug='accountant' AND organization_id IS NULL")).rows[0].id;
    assert.equal((await req('/me', staff.access)).status, 200);
    const g = await req(`/members/${staff.id}/roles`, director.access, 'POST', { role_id: roleId });
    const gtext = await g.text();
    assert.equal(g.status, 201, gtext.slice(0, 300));
    assert.equal((await req('/me', director.access)).status, 200); // l'acteur n'est pas touché
    assert.equal((await req('/me', staff.access)).status, 401, 'token en vol de la cible doit être révoqué');
    staff.access = (await login(staff.email, 'G4-Second-Password!')).access_token;
    assert.ok(claims(staff.access).roles.includes('accountant'), 'le nouveau token porte le rôle additionnel');
    assert.equal((await req('/me', staff.access)).status, 200);
    const list = await req(`/members/${staff.id}/roles`, director.access);
    const assignment = (await list.json()).find((a) => a.role_id === roleId);
    assert.ok(assignment, 'assignation listée');
    // (le endpoint de retrait répond 200 avec corps vide — pas de @HttpCode 204)
    assert.equal((await req(`/role-assignments/${assignment.id}`, director.access, 'DELETE')).status, 200);
    assert.equal((await req('/me', staff.access)).status, 401, 'retrait de rôle révoque aussi le token en vol');
  });

  // ── état de compte : suspension / suppression douce ─────────────────────
  await check('suspension du compte => 401 global immédiat; login 403; réactivation => relogin', async () => {
    assert.equal((await req('/me', parent.access)).status, 200);
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [parent.id]);
    assert.equal((await req('/me', parent.access)).status, 401);
    const loginRes = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: parent.email, password }) });
    assert.equal(loginRes.status, 403, 'la voie login garde son code métier (compte suspendu)');
    await db.query("UPDATE users SET status='active' WHERE id=$1", [parent.id]);
    parent.access = (await login(parent.email)).access_token;
    assert.equal((await req('/me', parent.access)).status, 200);
  });
  await check('suppression douce => 401 global; restauration => relogin OK', async () => {
    await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [parent.id]);
    assert.equal((await req('/me', parent.access)).status, 401);
    await db.query('UPDATE users SET deleted_at=NULL WHERE id=$1', [parent.id]);
    parent.access = (await login(parent.email)).access_token;
    assert.equal((await req('/me', parent.access)).status, 200);
  });

  // ── super-adminité : routes admin et voie metrics (garde propre) ────────
  await check('retrait de super-adminité => ancien JWT mort partout, y compris /metrics (401 au garde)', async () => {
    assert.equal((await req('/metrics', admin.access)).status, 200, 'préalable : metrics accessible à l\'admin');
    await db.query('UPDATE users SET is_super_admin=false WHERE id=$1', [admin.id]);
    assert.equal((await req('/me', admin.access)).status, 401);
    const m = await req('/metrics', admin.access);
    assert.equal(m.status, 401, `metrics doit refuser au garde avant toute exposition (reçu ${m.status})`);
  });

  // ── refresh : réédition cohérente avec l'époque courante ────────────────
  await check('refresh normal conserve l\'époque; suspension entre-temps => refresh refusé (403)', async () => {
    const first = await login(staff.email, 'G4-Second-Password!');
    const epoch0 = Number(claims(first.access_token).epoch);
    const rr = await req('/auth/refresh', null, 'POST', { refresh_token: first.refresh_token });
    assert.equal(rr.status, 200);
    const second = await rr.json();
    assert.equal(Number(claims(second.access_token).epoch), epoch0, 'sans changement d\'état, le refresh conserve l\'époque');
    assert.equal((await req('/me', second.access_token)).status, 200);
    await db.query("UPDATE users SET status='suspended' WHERE id=$1", [staff.id]);
    const r2 = await req('/auth/refresh', null, 'POST', { refresh_token: second.refresh_token });
    assert.equal(r2.status, 403, `refresh sur compte suspendu => refus métier (reçu ${r2.status})`);
    await db.query("UPDATE users SET status='active' WHERE id=$1", [staff.id]);
    staff.access = (await login(staff.email, 'G4-Second-Password!')).access_token;
  });

  // ── compatibilité tokens sans claim (déploiement progressif) ────────────
  // Un token « hérité » (instance antérieure à la 062, sans claim epoch) vaut
  // époque 0 : il fonctionne tant que le principal n'a jamais été révoqué, et
  // la première révocation le frappe comme les autres (epoch courante > 0).
  await check('token manuel sans claim epoch = époque 0 : valide avant, mort après révocation', async () => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'G4','Legacy',$2,'active',false) RETURNING id", [email, hash])).rows[0].id;
    const legacy = signHS256({ sub: id, purpose: 'access', role: 'none', roles: [], isSuperAdmin: false, organizationId: null, exp: Math.floor(Date.now() / 1000) + 900 }, jwtSecret());
    const pre = await req('/me', legacy);
    assert.equal(pre.status, 200, `avant révocation : compatible (reçu ${pre.status} ${await pre.text()})`);
    // L'attachement même d'une membership est un événement révocatoire (bump 0→1) :
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [org, id, 'educator']);
    const mid = await req('/me', legacy);
    assert.equal(mid.status, 401, `première révocation frappe le token hérité (reçu ${mid.status})`);
    await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [org, id]);
    assert.equal((await req('/me', legacy)).status, 401, 'révocation de membership : toujours 401');
  });

  // ── non-régressions des autres voies d'entrée ───────────────────────────
  await check('token purpose=device rejeté comme avant (le garde ne traite que purpose=access)', async () => {
    const t = signHS256({ sub: staff.id, purpose: 'device', exp: Math.floor(Date.now() / 1000) + 900 }, jwtSecret());
    assert.equal((await req('/me', t)).status, 401);
  });
  await check('jeton collecteur/generic invalide sur /metrics reste 401 (aucune interprétation de sub)', async () => {
    assert.equal((await req('/metrics', 'Bearer not-a-jwt')).status, 401);
  });
  await check('garde : revérification unique par requête, aucune signature dans le garde', async () => {
    const src = readFileSync(new URL('../../apps/api/src/shared/guards/jwt-auth.guard.ts', import.meta.url), 'utf8');
    assert.match(src, /token_epoch/, 'le garde doit revérifier l\'époque du principal');
    assert.ok(!/jwt\.sign|signAsync/.test(src), 'le garde ne signe rien');
  });
} finally {
  if (app) await app.close();
  try {
    await db.query('DELETE FROM role_assignments WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G4']);
    await db.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G4']);
    await db.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G4']);
    await db.query('DELETE FROM memberships WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM users WHERE first_name=$1', ['G4']);
    await db.query('DELETE FROM organizations WHERE id=$1', [org]);
  } catch { /* base de test jetable */ }
  await db.end();
}
console.log(`\nG4 principal revocation: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
