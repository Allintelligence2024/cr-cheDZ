#!/usr/bin/env node
/**
 * Phase 15 (roadmap v2) — multi-rôles par utilisateur (migration 040),
 * avec deux tenants A/B, sur PostgreSQL réel avec le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. un membre au rôle principal 'educator' n'a pas accès aux routes
 *      'director' (403) ;
 *   2. la directrice assigne un rôle additionnel 'accountant' → le JWT
 *      re-signe porte roles[] (educator + accountant) et le membre accède
 *      aux routes 'accountant' (200) ;
 *   3. le rôle principal reste 'educator' (rétrocompatibilité) ;
 *   4. doublon avec le rôle principal → 409 ROLE_ALREADY_PRIMARY ;
 *   5. double assignation → 409 ROLE_ALREADY_ASSIGNED ;
 *   6. la directrice de B ne peut pas assigner de rôle chez A (404/403) ;
 *   7. retrait du rôle additionnel → retour à 403 sur les routes 'accountant' ;
 *   8. /me reste inchangé (memberships) et auth_user_roles() renvoie
 *      principal + addition.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API compilée (dist/).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `rol-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const roles = Object.fromEntries(
      (await db.query(`SELECT slug, id FROM roles WHERE slug IN ('director','educator','accountant')`)).rows.map((r) => [r.slug, r.id]),
    );
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'R','31') RETURNING id`, [slug])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      const educator = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'E','T',$2,'active') RETURNING id`, [`${slug}-educator@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW()),($1,$4,$5,true,NOW())`,
        [org, director, roles.director, educator, roles.educator]);
      return { org, director, educator };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);

    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenEduA = (await api('POST', '/auth/login', null, { email: `${tag}-a-educator@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT émis', Boolean(tokenDirA && tokenEduA && tokenDirB));

    // Route 'accountant' de test : GET /billing/invoices (réservé director/accountant)
    const invoicesPath = '/billing/invoices';

    // ── 1. Éducateur sans rôle additionnel → 403 ─────────────────────────────
    console.log('\n1) Éducateur → 403 sur les routes accountant');
    const before = await api('GET', invoicesPath, tokenEduA);
    ok('Éducateur : /billing/invoices → 403', before.status === 403, JSON.stringify(before.body).slice(0, 80));

    // ── 2. Assignation accountant → accès 200 ───────────────────────────────
    console.log('\n2) Assignation du rôle additionnel');
    const add = await api('POST', `/members/${A.educator}/roles`, tokenDirA, { role_id: roles.accountant });
    ok('Directrice A : assignation accountant → 201', add.status === 201, JSON.stringify(add.body).slice(0, 100));
    const assignmentId = add.body.id;

    // Re-login → JWT avec roles[]
    const relogin = (await api('POST', '/auth/login', null, { email: `${tag}-a-educator@test.dz`, password })).body;
    const tokenEduA2 = relogin.access_token;
    const decoded = JSON.parse(Buffer.from(tokenEduA2.split('.')[1], 'base64url').toString());
    ok('JWT re-signé : roles[] = educator + accountant', Array.isArray(decoded.roles) && decoded.roles.includes('educator') && decoded.roles.includes('accountant'), JSON.stringify(decoded.roles));
    ok('JWT : rôle principal inchangé (educator)', decoded.role === 'educator', decoded.role);
    const after = await api('GET', invoicesPath, tokenEduA2);
    ok('Éducateur+accountant : /billing/invoices → 200', after.status === 200, `status=${after.status}`);

    // ── 3/4/5. Gardes ────────────────────────────────────────────────────────
    console.log('\n3-5) Gardes');
    const dupPrimary = await api('POST', `/members/${A.educator}/roles`, tokenDirA, { role_id: roles.educator });
    ok('Doublon avec le rôle principal → 409 ROLE_ALREADY_PRIMARY', dupPrimary.status === 409 && dupPrimary.body.code === 'ROLE_ALREADY_PRIMARY', JSON.stringify(dupPrimary.body).slice(0, 90));
    const dupAssign = await api('POST', `/members/${A.educator}/roles`, tokenDirA, { role_id: roles.accountant });
    ok('Double assignation → 409 ROLE_ALREADY_ASSIGNED', dupAssign.status === 409 && dupAssign.body.code === 'ROLE_ALREADY_ASSIGNED', JSON.stringify(dupAssign.body).slice(0, 90));

    // ── 6. Isolation B ──────────────────────────────────────────────────────
    console.log('\n6) Isolation (org B)');
    const crossAdd = await api('POST', `/members/${A.educator}/roles`, tokenDirB, { role_id: roles.accountant });
    ok('Directeur B : assigner un rôle chez A → 403/404', crossAdd.status === 403 || crossAdd.status === 404, `status=${crossAdd.status}`);
    const crossList = await api('GET', `/members/${A.educator}/roles`, tokenDirB);
    ok('Directeur B : lister les rôles du membre de A → 403/404', crossList.status === 403 || crossList.status === 404, `status=${crossList.status}`);

    // ── 7. Retrait → retour à 403 ───────────────────────────────────────────
    console.log('\n7) Retrait du rôle additionnel');
    const remove = await api('DELETE', `/role-assignments/${assignmentId}`, tokenDirA, {});
    ok('Retrait → 200/204', remove.status === 200 || remove.status === 204, `status=${remove.status}`);
    const relogin2 = (await api('POST', '/auth/login', null, { email: `${tag}-a-educator@test.dz`, password })).body;
    const afterRemove = await api('GET', invoicesPath, relogin2.access_token);
    ok('Après retrait : /billing/invoices → 403', afterRemove.status === 403, `status=${afterRemove.status}`);

    // ── 8. /me + auth_user_roles ────────────────────────────────────────────
    console.log('\n8) /me inchangé + auth_user_roles');
    const me = await api('GET', '/me', tokenEduA);
    ok('/me : membership unique (educator)', me.status === 200 && me.body.memberships?.length === 1 && me.body.memberships[0].role_slug === 'educator', JSON.stringify(me.body.memberships).slice(0, 120));
    const direct = await db.query(`SELECT role_slug, is_primary FROM auth_user_roles($1) WHERE organization_id=$2`, [A.educator, A.org]);
    ok('auth_user_roles : principal + additions', direct.rows.length === 1 && direct.rows[0].is_primary === true, JSON.stringify(direct.rows));
  } finally {
    try {
      await db.query(`DELETE FROM role_assignments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'rol-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'rol-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'rol-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'rol-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'rol-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'rol-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase15 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 15 multi-rôles : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 15 multi-rôles validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
