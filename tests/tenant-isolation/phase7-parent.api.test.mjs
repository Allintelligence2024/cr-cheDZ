#!/usr/bin/env node
/**
 * Phase 7 GATE — portail parent (isolation + consentements + OTP/PIN + push).
 *
 * Couvre les 11 cas obligatoires :
 *   1. parent A (can_view_journal=true) voit l'enfant et le fil ;
 *   2. parent B lié au même enfant mais can_view_journal=false → 403 ;
 *   3. parent B ne peut pas signaler l'absence ;
 *   4. parent B ne reçoit pas les URLs photo ;
 *   5. parent A perd immédiatement les URLs photo après révocation du consentement ;
 *   6. parent d'une organisation B ne voit rien de A ;
 *   7. préférences désactivées = pas de push mis en file ;
 *   8. quiet hours = push différé (scheduled_at futur) ;
 *   9. OTP expiré, OTP réutilisé, OTP après trop d'essais → refusés ;
 *  10. PIN incorrect → refusé ;
 *  11. exécuté sur PostgreSQL réel avec le rôle applicatif NOBYPASSRLS.
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
  // Base propre : la suite est autonome et ne pollue pas les autres phases
  // (les comptages globaux de phase3 en dépendent).
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test'; // SMS OTP désactivé + development_code exposé
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
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const tag = `p7-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const digits = () => String(Math.floor(1e8 + Math.random() * 9e8)); // 9 chiffres après +213
  const phoneA = `+213${digits()}`;
  const phoneB = `+213${digits()}`;
  const phoneC = `+213${digits()}`;

  try {
    // ── Données : org A (directeur, enfant Yanis, parents A/B), org B ──────
    const role = await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`);
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P7A','31') RETURNING id`, [tag]);
    const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
    const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
    const creator = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${tag}-director@test.dz`, hash]);
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, creator.rows[0].id, directorRole.rows[0].id]);
    const child = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P7-1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [org.rows[0].id, site.rows[0].id, room.rows[0].id, creator.rows[0].id],
    );
    const mk = async (email, phone) => {
      const u = await db.query(`INSERT INTO users(email,phone,first_name,last_name,password_hash,status) VALUES($1,$2,'P','T',$3,'active') RETURNING id`, [email, phone, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, u.rows[0].id, role.rows[0].id]);
      const g = await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`, [org.rows[0].id, u.rows[0].id, creator.rows[0].id]);
      return { u: u.rows[0].id, g: g.rows[0].id };
    };
    const allowed = await mk(`${tag}-a@test.dz`, phoneA);
    const denied = await mk(`${tag}-b@test.dz`, phoneB);
    await db.query(
      `INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_receive_invoices) VALUES($1,$2,$3,true,true),($1,$2,$4,false,false)`,
      [org.rows[0].id, child.rows[0].id, allowed.g, denied.g],
    );

    // Org B : un parent qui ne doit rien voir de A
    const orgB = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P7B','16') RETURNING id`, [`${tag}-b`]);
    const uB = await db.query(`INSERT INTO users(email,phone,first_name,last_name,password_hash,status) VALUES($1,$2,'Q','T',$3,'active') RETURNING id`, [`${tag}-b2@test.dz`, phoneC, hash]);
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgB.rows[0].id, uB.rows[0].id, role.rows[0].id]);
    await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'Q','T','parent',$3)`, [orgB.rows[0].id, uB.rows[0].id, creator.rows[0].id]);

    const ta = (await api('POST', '/auth/login', null, { email: `${tag}-a@test.dz`, password })).body.access_token;
    const tb = (await api('POST', '/auth/login', null, { email: `${tag}-b@test.dz`, password })).body.access_token;
    const tc = (await api('POST', '/auth/login', null, { email: `${tag}-b2@test.dz`, password })).body.access_token;
    ok('JWT parent A / B / org B émis', Boolean(ta && tb && tc));

    // ── 1. Parent autorisé : enfant + fil ───────────────────────────────────
    console.log('\n1) Accès du parent autorisé (can_view_journal=true)');
    const childrenA = await api('GET', '/parent/children', ta);
    ok('Parent A voit exactement son enfant', childrenA.status === 200 && childrenA.body.length === 1 && childrenA.body[0].id === child.rows[0].id);
    const feedA = await api('GET', `/parent/children/${child.rows[0].id}/feed`, ta);
    ok('Parent A accède au fil du jour (200)', feedA.status === 200);

    // ── 2/3. Parent B : fil bloqué, absence bloquée ─────────────────────────
    console.log('\n2-3) Parent B sans can_view_journal');
    const feedB = await api('GET', `/parent/children/${child.rows[0].id}/feed`, tb);
    ok('Parent B → 403 PARENT_ACCESS_DENIED sur le fil', feedB.status === 403 && feedB.body.code === 'PARENT_ACCESS_DENIED');
    const childrenB = await api('GET', '/parent/children', tb);
    ok('Parent B ne voit pas l’enfant (liste vide)', childrenB.status === 200 && childrenB.body.length === 0);
    const absentB = await api('POST', '/parent/absence', tb, { child_id: child.rows[0].id });
    ok('Parent B ne signale pas une absence → 403', absentB.status === 403);

    // ── 4/5. Photos : URLs signées + révocation immédiate ───────────────────
    console.log('\n4-5) Photos (URLs signées, révocation immédiate)');
    await api('POST', '/parent/consents', ta, { child_id: child.rows[0].id, consent_type: 'photo_individual', granted: true });
    const media = await db.query(
      `INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,is_visible_to_parents,all_consents_checked,children_in_photo,exif_stripped)
       VALUES($1,$2,$3,'photo',$5,'image/jpeg',true,true,$4::uuid[],true) RETURNING id`,
      [org.rows[0].id, child.rows[0].id, creator.rows[0].id, [child.rows[0].id], `p7/${tag}/fake-1.jpg`],
    );
    const mediaId = media.rows[0].id;
    const photosB = await api('GET', `/parent/children/${child.rows[0].id}/media`, tb);
    ok('Parent B ne reçoit pas les URLs photo → 403', photosB.status === 403);
    const photosA = await api('GET', `/parent/children/${child.rows[0].id}/media`, ta);
    ok('Parent A reçoit la photo avec URL signée', photosA.status === 200 && photosA.body.length === 1 && typeof photosA.body[0].url === 'string' && photosA.body[0].url.startsWith('http'));
    const downloadA = await api('GET', `/parent/children/${child.rows[0].id}/media/${mediaId}/download`, ta);
    ok('Parent A reçoit l’URL signée directe', downloadA.status === 200 && downloadA.body.url?.startsWith('http'));
    const revoked = await api('POST', '/parent/consents', ta, { child_id: child.rows[0].id, consent_type: 'photo_individual', granted: false });
    ok('Révocation du consentement acceptée', revoked.status === 201 || revoked.status === 200);
    const photosAfter = await api('GET', `/parent/children/${child.rows[0].id}/media`, ta);
    ok('Après révocation : plus aucune URL photo', photosAfter.status === 200 && photosAfter.body.length === 0);
    const downloadAfter = await api('GET', `/parent/children/${child.rows[0].id}/media/${mediaId}/download`, ta);
    ok('Après révocation : download → 422 CONSENT_REVOKED', downloadAfter.status === 422 && downloadAfter.body.code === 'CONSENT_REVOKED');

    // ── 6. Parent de l'org B ne voit rien de A ──────────────────────────────
    console.log('\n6) Isolation inter-organisations');
    const childrenC = await api('GET', '/parent/children', tc);
    ok('Parent de l’org B ne voit aucun enfant de A', childrenC.status === 200 && childrenC.body.length === 0);
    const feedC = await api('GET', `/parent/children/${child.rows[0].id}/feed`, tc);
    ok('Parent de l’org B → 403 sur le fil de A', feedC.status === 403);
    const absentC = await api('POST', '/parent/absence', tc, { child_id: child.rows[0].id });
    ok('Parent de l’org B ne signale pas d’absence chez A', absentC.status === 403);

    // ── 7/8. Préférences : désactivées = pas de push ; quiet hours = différé ─
    console.log('\n7-8) Préférences notification + quiet hours');
    const director = (await api('POST', '/auth/login', null, { email: `${tag}-director@test.dz`, password })).body.access_token;
    await api('POST', '/parent/notification-preferences', ta, { event_type: 'check_in', is_enabled: false });
    await api('POST', '/attendance/check-in', director, { child_id: child.rows[0].id });
    const queueRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id=$1 AND user_id=$2 AND channel='push' AND data->>'event_type'='check_in'`,
      [org.rows[0].id, allowed.u],
    );
    const inboxRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_inbox WHERE organization_id=$1 AND user_id=$2 AND type='check_in'`,
      [org.rows[0].id, allowed.u],
    );
    ok('Préférence désactivée : aucun push en file', queueRows.rows[0].n === 0, `file=${queueRows.rows[0].n}`);
    ok('Préférence désactivée : l’inbox in-app reste alimentée', inboxRows.rows[0].n === 1, `inbox=${inboxRows.rows[0].n}`);

    // quiet hours couvrant l'heure actuelle d'Alger
    const algiersNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const [hh, mm] = algiersNow.split(':').map(Number);
    const start = `${String((hh + 23) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const end = `${String((hh + 1) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    await api('POST', '/parent/notification-preferences', ta, { event_type: 'meal', is_enabled: true, quiet_hours_start: start, quiet_hours_end: end });
    await api('POST', '/journal/events', director, { child_id: child.rows[0].id, event_type: 'meal', meal_type: 'lunch', occurred_at: new Date().toISOString() });
    const quiet = await db.query(
      `SELECT scheduled_at > NOW() + INTERVAL '5 minutes' AS deferred FROM notification_queue
       WHERE organization_id=$1 AND user_id=$2 AND data->>'event_type'='meal' ORDER BY created_at DESC LIMIT 1`,
      [org.rows[0].id, allowed.u],
    );
    ok('Quiet hours : push différé (scheduled_at futur)', quiet.rows[0]?.deferred === true, JSON.stringify(quiet.rows[0]));

    // ── 9. OTP : expiré / réutilisé / trop d'essais ─────────────────────────
    console.log('\n9) OTP téléphone');
    const req1 = await api('POST', '/auth/parent/otp/request', null, { phone: phoneA });
    ok('OTP demandé (development_code en test)', req1.status === 200 && typeof req1.body.development_code === 'string');
    const code1 = req1.body.development_code;
    const verify1 = await api('POST', '/auth/parent/otp/verify', null, { phone: phoneA, code: code1 });
    ok('OTP correct → session parent', verify1.status === 200 && Boolean(verify1.body.access_token));
    const verifyReuse = await api('POST', '/auth/parent/otp/verify', null, { phone: phoneA, code: code1 });
    ok('OTP réutilisé → 401 OTP_INVALID', verifyReuse.status === 401 && verifyReuse.body.code === 'OTP_INVALID');

    const req2 = await api('POST', '/auth/parent/otp/request', null, { phone: phoneA });
    const code2 = req2.body.development_code;
    await db.query(`UPDATE otp_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE target=$1 AND purpose='parent_login' AND used_at IS NULL`, [phoneA]);
    const verifyExpired = await api('POST', '/auth/parent/otp/verify', null, { phone: phoneA, code: code2 });
    ok('OTP expiré → 401 OTP_INVALID', verifyExpired.status === 401 && verifyExpired.body.code === 'OTP_INVALID');

    const req3 = await api('POST', '/auth/parent/otp/request', null, { phone: phoneA });
    const code3 = req3.body.development_code;
    await db.query(`UPDATE otp_codes SET attempts = 5 WHERE target=$1 AND purpose='parent_login' AND used_at IS NULL`, [phoneA]);
    const verifyAttempts = await api('POST', '/auth/parent/otp/verify', null, { phone: phoneA, code: code3 });
    ok('OTP après 5 essais → 401 OTP_INVALID', verifyAttempts.status === 401 && verifyAttempts.body.code === 'OTP_INVALID');

    // ── 10. PIN parent ──────────────────────────────────────────────────────
    console.log('\n10) PIN parent');
    const setPin = await api('POST', '/auth/parent/pin', ta, { pin: '1234' });
    ok('PIN enregistré (204)', setPin.status === 204);
    const pinWrong = await api('POST', '/auth/parent/pin/login', null, { phone: phoneA, pin: '9999' });
    ok('PIN incorrect → 401 INVALID_PARENT_PIN', pinWrong.status === 401 && pinWrong.body.code === 'INVALID_PARENT_PIN');
    const pinOk = await api('POST', '/auth/parent/pin/login', null, { phone: phoneA, pin: '1234' });
    ok('PIN correct → session parent', pinOk.status === 200 && Boolean(pinOk.body.access_token));

    // ── 11. Rôle NOBYPASSRLS (preuve) ───────────────────────────────────────
    console.log('\n11) Rôle NOBYPASSRLS');
    const roleCheck = await db.query(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='creche_app_test'`);
    ok('API connectée en creche_app_test NOBYPASSRLS', roleCheck.rows[0]?.rolsuper === false && roleCheck.rows[0]?.rolbypassrls === false, JSON.stringify(roleCheck.rows[0]));
    const appConn = new pg.Client({ connectionString: appUrl() });
    await appConn.connect();
    try {
      await appConn.query('BEGIN');
      await appConn.query(`SELECT set_config('app.tenant_id', $1, true)`, [orgB.rows[0].id]);
      const cross = await appConn.query(`SELECT COUNT(*)::int AS n FROM children WHERE organization_id = $1`, [org.rows[0].id]);
      ok('Cross-tenant SQL direct impossible sous NOBYPASSRLS (0 ligne)', cross.rows[0].n === 0, `n=${cross.rows[0].n}`);
      const insertCross = await appConn.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,'P7-X','X','Y','2024-01-01',$4)`,
        [org.rows[0].id, site.rows[0].id, room.rows[0].id, creator.rows[0].id],
      ).then(() => true).catch(() => false);
      ok('Cross-tenant INSERT impossible sous NOBYPASSRLS', insertCross === false);
    } finally {
      await appConn.query('ROLLBACK').catch(() => undefined);
      await appConn.end();
    }
  } finally {
    // ── Nettoyage (ordre dépendant des FK) — même pattern que phase4-6 ─────
    try {
      await db.query(`DELETE FROM otp_codes WHERE target IN ($1,$2,$3)`, [phoneA, phoneB, phoneC]);
      await db.query(`DELETE FROM sync_operations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM sync_cursors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM media_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM media_assets WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM notification_queue WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM notification_inbox WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM consent_records WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p7-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p7-%')`);
      await db.query(`DELETE FROM devices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p7-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p7-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p7-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase7 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 7 : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 7 validée : portail parent isolé (11 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
