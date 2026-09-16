#!/usr/bin/env node
// G5 (audit 2026-09) — lot MFA : chiffrement du secret TOTP au repos,
// anti-rejeu PERSISTANT du code, et obligation du second facteur sur TOUS les
// canaux (login mot de passe, PIN parent, OTP parent, setup/confirm, disable).
//
// Audit : le secret était stocké en CLAIR (users.totp_secret base32), le code
// TOTP était réutilisable pendant toute la fenêtre (verify stateless ±1 pas),
// et les canaux parent PIN/OTP ignoraient totally totp_enabled — un porteur de
// PIN valide contournait le facteur ; de plus POST /auth/parent/pin (route
// protégée par simple JWT) permettait d'ajouter un contournement PIN à un
// compte MFA.
//
// Contrat vérifié ici (HTTP réel + PostgreSQL réel + redémarrages d'app
// réels pour la rotation de clé — aucune implémentation simulée) :
//  1. avec clé active, le secret est stocké scellé 'v1gcm.<iv>.<tag>.<ct>'
//     (AES-256-GCM, AAD = id utilisateur — un scellé ne migre pas entre comptes);
//  2. ligne legacy en clair : lisible, puis rescellée à l'usage (upgrade-on-use);
//  3. clé absente en test/dev : stockage historique, mais l'anti-rejeu s'applique déjà ;
//     production refuse le boot sans clé valide (et toute clé mal formée est refusée partout);
//  4. chaque code consommé enregistre le pas (users.totp_last_step) : aucun
//     rejeu sur login, PIN, OTP, 2fa/verify, 2fa/disable — y compris sous
//     concurrence réelle (une seule requête passe) ;
//  5. secret indéchiffrable (clé retirée, altération, AAD croisé) → 403
//     MFA_SECRET_UNREADABLE, sans session et sans toucher aux compteurs ;
//  6. rotation « nouvelle,anciennes » : decrypt à l'ancienne, rescellage à la courante.
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
await db.connect();
let app = null, base = '', passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.message}`); }
}
const KEY1 = randomBytes(32).toString('hex');
const KEY2 = randomBytes(32).toString('hex');
const KEY_UNKNOWN = randomBytes(32).toString('hex');
const STEP_MS = 30_000;
const step = () => Math.floor(Date.now() / STEP_MS);

// Même format que l'app (le helper de l'app EST le sujet ; ici on produit les
// entrées adverses et on vérifie l'interopérabilité par les flux réels).
const b64u = (b) => Buffer.from(b).toString('base64url');
function sealWith(keyHex, secret, userId) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  c.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1gcm.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}
async function lastStep(userId) {
  return Number((await db.query('SELECT COALESCE(totp_last_step, -1) AS e FROM users WHERE id=$1', [userId])).rows[0].e);
}
// Fenêtre de vérification = step courant ±1 ; ce helper choisit le plus petit
// pas de la fenêtre STRICTEMENT postérieur au pas déjà consommé (attend la
// frontière d'horloge si nécessaire) — anti-flakiness, pas un raccourci.
async function freshCounter(userId) {
  for (let i = 0; i < 130; i++) {
    const now = step();
    for (const s of [now - 1, now, now + 1]) {
      if (s > await lastStep(userId)) return s;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('no fresh TOTP step within window');
}
async function startApp(totpKeyEnv) {
  if (app) { await app.close(); app = null; }
  if (totpKeyEnv === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
  else process.env.TOTP_ENCRYPTION_KEY = totpKeyEnv;
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
}
const req = async (path, body, token, method = 'POST') => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: parsed };
};

try {
  await ensureAppRole(db);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', SENTRY_DSN: '' });

  const password = 'G5-Synthetic-Only!';
  const hash = await bcrypt.hash(password, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G5','31') RETURNING id", [randomUUID()])).rows[0].id;
  const { TotpService } = await import('../../apps/api/dist/modules/identity/totp.service.js');
  const totp = new TotpService();
  const mkUser = async () => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query(
      "INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'G5','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [org, id]);
    return { id, email };
  };
  const mkParent = async () => {
    const email = `${randomUUID()}@test.invalid`;
    const phone = `+2135${String(10000000 + Math.floor(Math.random() * 89999999))}`;
    const id = (await db.query(
      "INSERT INTO users(email,first_name,last_name,password_hash,status,phone) VALUES($1,'G5','Parent',$2,'active',$3) RETURNING id", [email, hash, phone])).rows[0].id;
    await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by) VALUES($1,$2,'G5','Parent','parent',$3,$2)", [org, id, phone]);
    return { id, email, phone };
  };

  // ── App SANS clé (mode historique) : structure + compat ────────────────
  await startApp(undefined);
  await check('users.totp_last_step : bigint nullable; migration additive, rejeu idempotent', async () => {
    const c = (await db.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='totp_last_step'`)).rows[0];
    assert.ok(c, 'colonne absente — migration 063 requise');
    assert.equal(c.data_type, 'bigint');
    assert.equal(c.is_nullable, 'YES');
    const sql = readFileSync(new URL('../../infrastructure/database/migrations/063_mfa_totp_hardening.sql', import.meta.url), 'utf8');
    assert.ok(!/UPDATE\s+users\s+SET/i.test(sql) && !/DELETE\s+FROM/i.test(sql), 'aucune mutation de données dans la migration');
    await db.query(sql);
  });
  await check('sans clé active (test/dev), enable conserve le stockage historique en clair', async () => {
    const u = await mkUser();
    const login = await req('/auth/login', { email: u.email, password });
    const r = await req('/auth/2fa/enable', undefined, login.body.access_token);
    assert.equal(r.status, 200);
    const row = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [u.id])).rows[0];
    assert.equal(row.totp_secret, r.body.secret);
  });

  // ── Avec clé : scellage, round-trip, anti-rejeu ─────────────────────────
  await startApp(KEY1);
  const mfa = await mkUser();
  let plainSecret = null;
  await check('avec TOTP_ENCRYPTION_KEY : secret stocké scellé v1gcm après confirm; jamais de clair en base', async () => {
    const login = await req('/auth/login', { email: mfa.email, password });
    mfa.token = login.body.access_token;
    const en = await req('/auth/2fa/enable', undefined, mfa.token);
    assert.equal(en.status, 200);
    plainSecret = en.body.secret;
    const v = await req('/auth/2fa/verify', { code: totp.generate(plainSecret, await freshCounter(mfa.id)) }, mfa.token);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const row = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [mfa.id])).rows[0];
    assert.ok(String(row.totp_secret).startsWith('v1gcm.'), `stockage non scellé: ${String(row.totp_secret).slice(0, 20)}`);
    assert.ok(!String(row.totp_secret).includes(plainSecret));
  });
  await check('login scellé OK et pas consommé persisté, strictement croissant', async () => {
    const s1 = await freshCounter(mfa.id);
    const l1 = await req('/auth/login', { email: mfa.email, password, totp_code: totp.generate(plainSecret, s1) });
    assert.equal(l1.status, 200, JSON.stringify(l1.body));
    const e1 = await lastStep(mfa.id);
    const s2 = await freshCounter(mfa.id);
    const l2 = await req('/auth/login', { email: mfa.email, password, totp_code: totp.generate(plainSecret, s2) });
    assert.equal(l2.status, 200);
    const e2 = await lastStep(mfa.id);
    assert.ok(e2 > e1 && e2 >= s2, `pas enregistré incohérent: ${e1} -> ${e2} (s2=${s2})`);
  });
  await check('anti-rejeu login: même code rejoué → 401 TOTP_INVALID + failed_attempts +1', async () => {
    const before = (await db.query('SELECT failed_attempts FROM users WHERE id=$1', [mfa.id])).rows[0].failed_attempts;
    const s = await freshCounter(mfa.id);
    const code = totp.generate(plainSecret, s);
    assert.equal((await req('/auth/login', { email: mfa.email, password, totp_code: code })).status, 200);
    const replay = await req('/auth/login', { email: mfa.email, password, totp_code: code });
    assert.equal(replay.status, 401, JSON.stringify(replay.body));
    assert.equal(replay.body.code, 'TOTP_INVALID');
    const after = (await db.query('SELECT failed_attempts FROM users WHERE id=$1', [mfa.id])).rows[0].failed_attempts;
    assert.equal(after, Number(before) + 1, 'rejeu = preuve invalide (compteur partagé G1d)');
  });
  await check('concurrence réelle: deux logins simultanés au même pas → une seule session', async () => {
    const before = Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL', [mfa.id])).rows[0].n);
    const s = await freshCounter(mfa.id);
    const code = totp.generate(plainSecret, s);
    const [a, b] = await Promise.allSettled([
      req('/auth/login', { email: mfa.email, password, totp_code: code }),
      req('/auth/login', { email: mfa.email, password, totp_code: code }),
    ]);
    const oks = [a, b].filter(x => x.status === 'fulfilled' && x.value.status === 200);
    assert.equal(oks.length, 1, `un seul login doit passer (${[a, b].map(x => x.status === 'fulfilled' ? x.value.status : 'ERR').join(',')})`);
    const after = Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL', [mfa.id])).rows[0].n);
    assert.equal(after, before + 1);
  });
  await check('ligne legacy en clair: login OK puis rescellage upgrade-on-use', async () => {
    const u = await mkUser();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [u.id, secret]);
    const l = await req('/auth/login', { email: u.email, password, totp_code: totp.generate(secret, await freshCounter(u.id)) });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const row = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [u.id])).rows[0];
    assert.ok(String(row.totp_secret).startsWith('v1gcm.'), 'la ligne a été scellée à l’usage');
    const again = await req('/auth/login', { email: u.email, password, totp_code: totp.generate(secret, await freshCounter(u.id)) });
    assert.equal(again.status, 200, 'le rescellage ne casse pas la vérification suivante');
  });

  // ── Indéchiffrable ────────────────────────────────────────────────────────
  await check('scellé avec clé inconnue → 403 MFA_SECRET_UNREADABLE, sans session ni compteur touché', async () => {
    const u = await mkUser();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [u.id, sealWith(KEY_UNKNOWN, secret, u.id)]);
    const before = (await db.query('SELECT failed_attempts FROM users WHERE id=$1', [u.id])).rows[0].failed_attempts;
    const sessionsBefore = Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1', [u.id])).rows[0].n);
    const r = await req('/auth/login', { email: u.email, password, totp_code: totp.generate(secret, await freshCounter(u.id)) });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'MFA_SECRET_UNREADABLE');
    assert.ok(!JSON.stringify(r.body).includes(secret));
    assert.ok(!JSON.stringify(r.body).includes('v1gcm'), 'pas de matière chiffrée dans la réponse');
    assert.equal((await db.query('SELECT failed_attempts FROM users WHERE id=$1', [u.id])).rows[0].failed_attempts, before, 'erreur d\'exploitation: ne pénalise pas l\'utilisateur');
    assert.equal(Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1', [u.id])).rows[0].n), sessionsBefore);
  });
  await check('ciphertext altéré → refus GCM tag propre (403), pas un 500', async () => {
    const u = await mkUser();
    const secret = totp.generateSecret();
    const parts = sealWith(KEY1, secret, u.id).split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [u.id, parts.join('.')]);
    const r = await req('/auth/login', { email: u.email, password, totp_code: totp.generate(secret, await freshCounter(u.id)) });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'MFA_SECRET_UNREADABLE');
  });
  await check('AAD lié au compte: un scellé préparé pour A ne se déchiffre pas pour B', async () => {
    const a = await mkUser(), b = await mkUser();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [b.id, sealWith(KEY1, secret, a.id)]);
    const r = await req('/auth/login', { email: b.email, password, totp_code: totp.generate(secret, await freshCounter(b.id)) });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MFA_SECRET_UNREADABLE');
  });

  // ── Rotation (redémarrages réels) ────────────────────────────────────────
  await startApp(`${KEY2},${KEY1}`);
  await check('rotation: decrypt à l\'ancienne clé, rescellage à la courante, puis autonomie nouvelle clé seule', async () => {
    const before = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [mfa.id])).rows[0].totp_secret;
    const l = await req('/auth/login', { email: mfa.email, password, totp_code: totp.generate(plainSecret, await freshCounter(mfa.id)) });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const after = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [mfa.id])).rows[0].totp_secret;
    assert.notEqual(after, before, 'la ligne a été rescellée sous la nouvelle clé');
    assert.ok(String(after).startsWith('v1gcm.'));
    await startApp(KEY2);
    const l2 = await req('/auth/login', { email: mfa.email, password, totp_code: totp.generate(plainSecret, await freshCounter(mfa.id)) });
    assert.equal(l2.status, 200, 'post-rotation: le nouveau scellage est autonome');
  });
  await startApp(KEY1);

  // ── Canaux parent ────────────────────────────────────────────────────────
  await check('compte MFA: POST /auth/parent/pin exige un totp_code FRAIS (401 TOTP_REQUIRED sinon), écrit le PIN sinon', async () => {
    const p = await mkParent();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [p.id, sealWith(KEY1, secret, p.id)]);
    const login = await req('/auth/login', { email: p.email, password, totp_code: totp.generate(secret, await freshCounter(p.id)) });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const noCode = await req('/auth/parent/pin', { pin: '4321' }, login.body.access_token);
    assert.equal(noCode.status, 401, JSON.stringify(noCode.body));
    assert.equal(noCode.body.code, 'TOTP_REQUIRED');
    const withCode = await req('/auth/parent/pin', { pin: '4321', totp_code: totp.generate(secret, await freshCounter(p.id)) }, login.body.access_token);
    assert.equal(withCode.status, 204, JSON.stringify(withCode.body));
    assert.ok((await db.query('SELECT parent_pin_hash IS NOT NULL AS ok FROM users WHERE id=$1', [p.id])).rows[0].ok);
  });
  await check('PIN correct mais facteur absent → 401 TOTP_REQUIRED; avec code → 200; rejeu trans-canal → 401', async () => {
    const p = await mkParent();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true, parent_pin_hash=$3 WHERE id=$1', [p.id, sealWith(KEY1, secret, p.id), await bcrypt.hash('123456', 4)]);
    const r1 = await req('/auth/parent/pin/login', { phone: p.phone, pin: '123456' });
    assert.equal(r1.status, 401, JSON.stringify(r1.body));
    assert.equal(r1.body.code, 'TOTP_REQUIRED');
    const s = await freshCounter(p.id);
    const code = totp.generate(secret, s);
    const r2 = await req('/auth/parent/pin/login', { phone: p.phone, pin: '123456', totp_code: code });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.ok(r2.body.access_token);
    const r3 = await req('/auth/parent/pin/login', { phone: p.phone, pin: '123456', totp_code: code });
    assert.equal(r3.status, 401, 'anti-rejeu persistant trans-canal');
    assert.equal(r3.body.code, 'TOTP_INVALID');
    // et le login MOT DE PASSE avec le même pas est aussi bloqué (état partagé)
    const r4 = await req('/auth/login', { email: p.email, password, totp_code: totp.generate(secret, s) });
    assert.equal(r4.status, 401, 'dernier pas consommé partagé entre canaux');
  });
  await check('OTP parent: OTP valide sans totp_code → 401 TOTP_REQUIRED (OTP déjà consommé, pas de session); avec code → 200', async () => {
    const p = await mkParent();
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret=$2, totp_enabled=true WHERE id=$1', [p.id, sealWith(KEY1, secret, p.id)]);
    const rq = await req('/auth/parent/otp/request', { phone: p.phone });
    assert.equal(rq.status, 200, JSON.stringify(rq.body));
    const v1 = await req('/auth/parent/otp/verify', { phone: p.phone, code: rq.body.development_code });
    assert.equal(v1.status, 401, JSON.stringify(v1.body));
    assert.equal(v1.body.code, 'TOTP_REQUIRED');
    assert.equal(Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1', [p.id])).rows[0].n), 0, 'refus = aucune session');
    const rq2 = await req('/auth/parent/otp/request', { phone: p.phone });
    const v2 = await req('/auth/parent/otp/verify', { phone: p.phone, code: rq2.body.development_code, totp_code: totp.generate(secret, await freshCounter(p.id)) });
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    assert.ok(v2.body.access_token);
  });

  // ── Gestion du facteur ───────────────────────────────────────────────────
  await check('2fa: disable au même code qu\'un confirm = rejeu (401); au pas suivant = 200 et facteur retiré', async () => {
    const u = await mkUser();
    const login = await req('/auth/login', { email: u.email, password });
    const en = await req('/auth/2fa/enable', undefined, login.body.access_token);
    assert.equal(en.status, 200);
    const code = totp.generate(en.body.secret, await freshCounter(u.id));
    const v = await req('/auth/2fa/verify', { code }, login.body.access_token);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const d1 = await req('/auth/2fa/disable', { code }, login.body.access_token);
    assert.equal(d1.status, 401, `disable avec code rejoué refusé (reçu ${d1.status})`);
    assert.equal(d1.body.code, 'TOTP_INVALID');
    const d2 = await req('/auth/2fa/disable', { code: totp.generate(en.body.secret, await freshCounter(u.id)) }, login.body.access_token);
    assert.equal(d2.status, 200, JSON.stringify(d2.body));
    assert.equal((await db.query('SELECT totp_enabled FROM users WHERE id=$1', [u.id])).rows[0].totp_enabled, false);
  });

  // ── Non-fuite + config ───────────────────────────────────────────────────
  await check('audit et réponses ne contiennent ni secret clair ni matière scellée', async () => {
    const leaks = await db.query(
      "SELECT to_jsonb(a)::text j FROM audit_logs a WHERE a.user_id IN (SELECT id FROM users WHERE first_name='G5') ORDER BY id DESC LIMIT 300",
    );
    for (const r of leaks.rows) {
      assert.ok(!r.j.includes(plainSecret), 'audit fuit le secret');
      assert.ok(!/v1gcm\./.test(r.j), 'audit contient une matière scellée');
    }
  });
  await check('prod refuse le boot sans TOTP_ENCRYPTION_KEY; clé mal formée refusée partout; liste admise', async () => {
    const { assertProductionConfig } = await import('@creche/prod-config');
    const baseCfg = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://creche_app:x@h:5432/creche_prod',
      JWT_SECRET: 'x'.repeat(32), PAYMENT_WEBHOOK_SECRET: 'p'.repeat(32),
      STORAGE_BACKEND: 's3', S3_BUCKET: 'prod-bucket', S3_ENDPOINT: 'https://s3.example',
      S3_ACCESS_KEY: 'prod-access', S3_SECRET_KEY: 'prod-secret-value',
    };
    assert.throws(() => assertProductionConfig(baseCfg), /TOTP_ENCRYPTION_KEY/);
    assert.throws(() => assertProductionConfig({ ...baseCfg, TOTP_ENCRYPTION_KEY: 'tooshort' }), /TOTP_ENCRYPTION_KEY/);
    assert.doesNotThrow(() => assertProductionConfig({ ...baseCfg, TOTP_ENCRYPTION_KEY: KEY1 }));
    assert.doesNotThrow(() => assertProductionConfig({ ...baseCfg, TOTP_ENCRYPTION_KEY: `${KEY1},${KEY2}` }));
  });
  await check('mode SANS clé: stockage en clair conservé, anti-rejeu déjà actif (indépendant du chiffrement)', async () => {
    await startApp(undefined);
    const u = await mkUser();
    const login = await req('/auth/login', { email: u.email, password });
    const en = await req('/auth/2fa/enable', undefined, login.body.access_token);
    const v = await req('/auth/2fa/verify', { code: totp.generate(en.body.secret, await freshCounter(u.id)) }, login.body.access_token);
    assert.equal(v.status, 200);
    const row = (await db.query('SELECT totp_secret FROM users WHERE id=$1', [u.id])).rows[0];
    assert.ok(!String(row.totp_secret).startsWith('v1gcm.'), 'sans clé : pas de faux scellage');
    const s = await freshCounter(u.id);
    const code = totp.generate(en.body.secret, s);
    assert.equal((await req('/auth/login', { email: u.email, password, totp_code: code })).status, 200);
    const replay = await req('/auth/login', { email: u.email, password, totp_code: code });
    assert.equal(replay.status, 401, 'l\'anti-rejeu ne dépend pas de la clé');
    assert.equal((await req('/auth/parent/pin', { pin: '9876' }, undefined)).status, 401);
  });
} finally {
  if (app) { try { await app.close(); } catch { /* noop */ } }
  try {
    await db.query('DELETE FROM role_assignments WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G5']);
    await db.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G5']);
    await db.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE first_name=$1)', ['G5']);
    await db.query('DELETE FROM otp_codes WHERE target IN (SELECT phone FROM users WHERE first_name=$1 AND phone IS NOT NULL)', ['G5']);
    await db.query('DELETE FROM guardians WHERE created_by IN (SELECT id FROM users WHERE first_name=$1)', ['G5']);
    await db.query('DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE name_fr=$1)', ['G5']);
    await db.query('DELETE FROM users WHERE first_name=$1', ['G5']);
    await db.query('DELETE FROM organizations WHERE name_fr=$1', ['G5']);
  } catch { /* base de test jetable */ }
  await db.end();
}
console.log(`\nG5 MFA hardening: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
