#!/usr/bin/env node
/**
 * Test d'isolation au niveau API (Phase 2 — le GATE exposé via HTTP).
 *
 * Prérequis : apps/api compilé (dist/) et DATABASE_URL valide.
 * Le script applique migrations + seeds, démarre l'application NestJS
 * sur un port libre, puis vérifie :
 *
 *  1. Login OK (JWT access + refresh), rôle et org corrects dans /me
 *  2. Mauvais mot de passe → 401 INVALID_CREDENTIALS
 *  3. Verrouillage après 5 échecs → 423 ACCOUNT_LOCKED
 *  4. Isolation : A ne voit pas les salles de B (404), B voit les siennes
 *  5. Rotation du refresh : l'ancien jeton réutilisé → 401 SESSION_REUSE_DETECTED
 *  6. Révocation d'appareil : refresh lié à l'appareil → 403 DEVICE_REVOKED
 *  7. Audit : login journalisé, masquage PII (redact)
 *  8. 2FA TOTP : enable → verify → login sans code rejeté / avec code OK
 *  9. Changement de mot de passe : l'ancien ne fonctionne plus
 * 10. Corps d'erreur normalisé : { code, message_fr, message_ar, correlation_id }
 *
 * Usage : node tests/tenant-isolation/isolation.api.test.mjs
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
import { appUrl, ensureAppRole } from './helpers.mjs';

const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  // 1. Migrations + seeds (base propre pour le test)
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  // 2. Démarrage de l'application (dist) — connectée avec le rôle applicatif
  //    NOBYPASSRLS : sans lui, le superuser contournerait la RLS (C06).
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  // Rate limiting désactivé pendant les tests d'intégration (le verrouillage
  // de compte 423 est testé séparément ; nginx enforce les limites en prod).
  process.env.RATE_LIMIT_DISABLED = 'true';

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const { redact } = await import(pathToFileURL(join(REPO, 'apps/api/dist/shared/redact.js')).href);
  const { TotpService } = await import(
    pathToFileURL(join(REPO, 'apps/api/dist/modules/identity/totp.service.js')).href,
  );
  const totp = new TotpService();

  const app = await createApp();
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  try {
    // ── Setup : orgs, salles, utilisateurs (via SQL admin) ────────────────
    const orgA = await admin.query(
      `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('api-test-a', 'Crèche API A', '31') RETURNING id`,
    );
    const orgB = await admin.query(
      `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('api-test-b', 'Crèche API B', '31') RETURNING id`,
    );
    const siteA = await admin.query(
      `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site A') RETURNING id`,
      [orgA.rows[0].id],
    );
    const siteB = await admin.query(
      `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site B') RETURNING id`,
      [orgB.rows[0].id],
    );
    const roomA1 = await admin.query(
      `INSERT INTO rooms (organization_id, site_id, name_fr) VALUES ($1, $2, 'Bébés A1') RETURNING id`,
      [orgA.rows[0].id, siteA.rows[0].id],
    );
    const roomB1 = await admin.query(
      `INSERT INTO rooms (organization_id, site_id, name_fr) VALUES ($1, $2, 'Bébés B1') RETURNING id`,
      [orgB.rows[0].id, siteB.rows[0].id],
    );
    const password = 'Password123!';
    const hash = await bcrypt.hash(password, 12);
    const userA = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('api.edu.a@test.dz', 'Amel', 'A', $1, 'active') RETURNING id`,
      [hash],
    );
    const userB = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('api.edu.b@test.dz', 'Brahim', 'B', $1, 'active') RETURNING id`,
      [hash],
    );
    const userLock = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('api.lock@test.dz', 'Lina', 'Lock', $1, 'active') RETURNING id`,
      [hash],
    );
    const directorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'director'`);
    await admin.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, site_id, is_active, joined_at)
       VALUES ($1, $2, $3, $4, true, NOW())`,
      [orgA.rows[0].id, userA.rows[0].id, directorRole.rows[0].id, siteA.rows[0].id],
    );
    await admin.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, site_id, is_active, joined_at)
       VALUES ($1, $2, $3, $4, true, NOW())`,
      [orgB.rows[0].id, userB.rows[0].id, directorRole.rows[0].id, siteB.rows[0].id],
    );

    async function api(method, path, token, body) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json };
    }

    // ── 1. Login OK ────────────────────────────────────────────────────────
    console.log('\n1) Authentification');
    const loginA = await api('POST', '/auth/login', null, {
      email: 'api.edu.a@test.dz',
      password,
    });
    check('Login A → 200 avec tokens', loginA.status === 200 && loginA.body.access_token && loginA.body.refresh_token,
      `status=${loginA.status} ${JSON.stringify(loginA.body)}`);
    check('Login A → organization_id = A', loginA.body.user?.organization_id === orgA.rows[0].id);
    check('Login A → rôle director', loginA.body.user?.role === 'director');

    const meA = await api('GET', '/me', loginA.body.access_token);
    check('/me A → org A + nom organisation', meA.status === 200
      && meA.body.memberships?.[0]?.organization_id === orgA.rows[0].id
      && meA.body.memberships?.[0]?.organization_name === 'Crèche API A',
      JSON.stringify(meA.body)?.slice(0, 200));
    check('/me A → permissions director non vides', Array.isArray(meA.body.memberships?.[0]?.permissions)
      && meA.body.memberships[0].permissions.length > 0);

    // ── 2. Mauvais mot de passe ────────────────────────────────────────────
    const badLogin = await api('POST', '/auth/login', null, {
      email: 'api.edu.a@test.dz',
      password: 'WrongPassword1!',
    });
    check('Mauvais mot de passe → 401 INVALID_CREDENTIALS',
      badLogin.status === 401 && badLogin.body.code === 'INVALID_CREDENTIALS');

    // ── 3. Verrouillage après 5 échecs ─────────────────────────────────────
    for (let i = 0; i < 5; i += 1) {
      await api('POST', '/auth/login', null, { email: 'api.lock@test.dz', password: 'WrongPassword1!' });
    }
    const lockedLogin = await api('POST', '/auth/login', null, {
      email: 'api.lock@test.dz',
      password,
    });
    check('Verrouillage après 5 échecs → 423 ACCOUNT_LOCKED',
      lockedLogin.status === 423 && lockedLogin.body.code === 'ACCOUNT_LOCKED',
      `status=${lockedLogin.status} code=${lockedLogin.body.code}`);

    // ── 4. Isolation via l'API ─────────────────────────────────────────────
    console.log('\n2) Isolation multi-tenant (API)');
    const loginB = await api('POST', '/auth/login', null, { email: 'api.edu.b@test.dz', password });
    const roomsA = await api('GET', '/rooms', loginA.body.access_token);
    check('A liste ses salles uniquement', roomsA.status === 200
      && roomsA.body.items.length === 1
      && roomsA.body.items[0].id === roomA1.rows[0].id,
      JSON.stringify(roomsA.body));

    const readRoomBAsA = await api('GET', `/rooms/${roomB1.rows[0].id}`, loginA.body.access_token);
    check('A lit la salle de B → 404 (pas de fuite)', readRoomBAsA.status === 404
      && readRoomBAsA.body.code === 'NOT_FOUND');

    const readRoomBAsB = await api('GET', `/rooms/${roomB1.rows[0].id}`, loginB.body.access_token);
    check('B lit sa propre salle → 200', readRoomBAsB.status === 200
      && readRoomBAsB.body.id === roomB1.rows[0].id);

    const noTokenRooms = await api('GET', '/rooms');
    check('Sans jeton → 401 UNAUTHORIZED', noTokenRooms.status === 401
      && noTokenRooms.body.code === 'UNAUTHORIZED');

    // ── 5. Rotation du refresh + détection de réutilisation ────────────────
    console.log('\n3) Refresh rotatif');
    const refresh1 = await api('POST', '/auth/refresh', null, {
      refresh_token: loginA.body.refresh_token,
    });
    check('Refresh OK → nouveau couple de jetons', refresh1.status === 200
      && refresh1.body.access_token && refresh1.body.refresh_token);

    const reuse = await api('POST', '/auth/refresh', null, {
      refresh_token: loginA.body.refresh_token, // ancien jeton réutilisé
    });
    check('Ancien refresh réutilisé → 401 SESSION_REUSE_DETECTED',
      reuse.status === 401 && reuse.body.code === 'SESSION_REUSE_DETECTED');

    const sessionsAfterReuse = await admin.query(
      `SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [userA.rows[0].id],
    );
    check('Réutilisation → toutes les sessions de A révoquées',
      sessionsAfterReuse.rows[0].n === 0, `sessions actives: ${sessionsAfterReuse.rows[0].n}`);

    // ── 6. Révocation d'appareil ───────────────────────────────────────────
    console.log('\n4) Appareils et révocation distante');
    const loginA2 = await api('POST', '/auth/login', null, { email: 'api.edu.a@test.dz', password });
    const dev = await api('POST', '/devices', loginA2.body.access_token, {
      name: 'Tablette Section Bébés',
      device_fingerprint: 'fp-tablette-abcdef123456',
      platform: 'android',
      app_version: '0.1.0',
    });
    check('Enregistrement d\'appareil → device_id', dev.status === 201 && dev.body.device_id,
      `status=${dev.status} ${JSON.stringify(dev.body)}`);

    const loginWithDevice = await api('POST', '/auth/login', null, {
      email: 'api.edu.a@test.dz',
      password,
      device_id: dev.body.device_id,
    });
    const revokeDev = await api('POST', `/devices/${dev.body.device_id}/revoke`, loginA2.body.access_token);
    check('Révocation appareil → 204', revokeDev.status === 204, `status=${revokeDev.status}`);

    const refreshAfterRevoke = await api('POST', '/auth/refresh', null, {
      refresh_token: loginWithDevice.body.refresh_token,
    });
    check('Refresh après révocation → 403 DEVICE_REVOKED',
      refreshAfterRevoke.status === 403 && refreshAfterRevoke.body.code === 'DEVICE_REVOKED',
      `status=${refreshAfterRevoke.status} code=${refreshAfterRevoke.body.code}`);

    // ── 7. Audit + masquage ────────────────────────────────────────────────
    console.log('\n5) Audit et masquage PII');
    const audits = await admin.query(
      `SELECT action, new_values FROM audit_logs WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 5`,
      [userA.rows[0].id],
    );
    check('Audit : login journalisé', audits.rows.some((r) => r.action === 'login'));
    check('Audit : device revoked journalisé', audits.rows.some((r) => r.action === 'revoke'));

    const redacted = redact({
      password_hash: 'x',
      totp_secret: 'SECRET',
      email: 'a@b.dz',
      phone: '0550000000',
      national_id: '12345',
      health_observation: 'fièvre',
      safe: 'ok',
    });
    check('Redact : PII masquées',
      redacted.password_hash === '[REDACTED]' && redacted.email === '[REDACTED]'
      && redacted.health_observation === '[REDACTED]' && redacted.safe === 'ok');

    // ── 8. 2FA TOTP ────────────────────────────────────────────────────────
    console.log('\n6) 2FA TOTP');
    const enable2fa = await api('POST', '/auth/2fa/enable', loginA2.body.access_token);
    check('2FA enable → secret + otpauth_url', enable2fa.status === 200
      && enable2fa.body.secret && enable2fa.body.otpauth_url.startsWith('otpauth://'),
      JSON.stringify(enable2fa.body)?.slice(0, 120));

    const code = totp.generate(enable2fa.body.secret);
    const verify2fa = await api('POST', '/auth/2fa/verify', loginA2.body.access_token, { code });
    check('2FA verify → enabled', verify2fa.status === 200 && verify2fa.body.enabled === true);

    const loginNoCode = await api('POST', '/auth/login', null, { email: 'api.edu.a@test.dz', password });
    check('Login sans code 2FA → 401 TOTP_INVALID', loginNoCode.status === 401
      && loginNoCode.body.code === 'TOTP_INVALID');

    const freshCode = totp.generate(enable2fa.body.secret);
    const loginWithCode = await api('POST', '/auth/login', null, {
      email: 'api.edu.a@test.dz',
      password,
      totp_code: freshCode,
    });
    check('Login avec code 2FA → 200', loginWithCode.status === 200);

    // ── 9. Changement de mot de passe ──────────────────────────────────────
    console.log('\n7) Changement de mot de passe');
    const changePw = await api('POST', '/auth/change-password', loginA2.body.access_token, {
      old_password: password,
      new_password: 'NewPassword456!',
    });
    check('Change-password → 204', changePw.status === 204, `status=${changePw.status}`);
    const oldPwLogin = await api('POST', '/auth/login', null, { email: 'api.edu.a@test.dz', password });
    check('Ancien mot de passe → 401', oldPwLogin.status === 401);
    const newPwLogin = await api('POST', '/auth/login', null, {
      email: 'api.edu.a@test.dz',
      password: 'NewPassword456!',
      totp_code: totp.generate(enable2fa.body.secret),
    });
    check('Nouveau mot de passe + 2FA → 200', newPwLogin.status === 200);

    // ── 10. Corps d'erreur normalisé ───────────────────────────────────────
    console.log('\n8) Corps d\'erreur normalisé');
    check('Corps d\'erreur : code + FR + AR + correlation_id',
      typeof readRoomBAsA.body.code === 'string'
      && typeof readRoomBAsA.body.message_fr === 'string'
      && typeof readRoomBAsA.body.message_ar === 'string'
      && typeof readRoomBAsA.body.correlation_id === 'string');

    // ── Nettoyage (ordre dépendant des FK) ─────────────────────────────────
    await admin.query(`DELETE FROM devices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'api.%@test.dz')`);
    await admin.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'api.%@test.dz')`);
    await admin.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'api-test-%')`);
    await admin.query(`DELETE FROM users WHERE email LIKE 'api.%@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'api-test-%'`);
  } finally {
    await app.close();
    await admin.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} test(s) en échec.`);
    process.exit(1);
  }
  console.log('✓ Isolation API vérifiée : aucun accès cross-tenant via HTTP.');
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.stack ?? error.message);
  process.exit(1);
});
