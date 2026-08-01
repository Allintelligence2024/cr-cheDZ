#!/usr/bin/env node
/**
 * Test API — Phase 6 (journal quotidien, médias, notifications, worker).
 *
 * Prérequis : apps/api + apps/worker compilés (dist/) et DATABASE_URL valide.
 * Vérifie :
 *  1. Journal HTTP : meal → daily_log_events + agrégats ; note privée hors fil ;
 *     incident → notification parent ; correction append-only
 *  2. Action groupée (repas de section) : 12 enfants → 12 événements
 *  3. Médias : presign (URL signée S3), register, consentement obligatoire (422),
 *     consentement OK → visible, download journalisé, cross-tenant 404,
 *     rôles (éducatrice ne publie pas), consentement révoqué → 422
 *  4. Sync : add_photo → media créé non visible ; log_incident → notification
 *  5. Notifications : check_in → notification_queue + inbox (gardien can_receive_push)
 *  6. Worker : processNextJob (job done) + drainNotificationQueue (sent)
 *  7. Stress : 60 opérations offline mixtes → agrégats exacts
 *
 * Usage : node tests/tenant-isolation/phase6.api.test.mjs
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

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

  try {
    // ── Setup ───────────────────────────────────────────────────────────────
    const password = 'Password123!';
    const hash = await bcrypt.hash(password, 12);
    const directorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'director'`);
    const educatorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'educator'`);

    async function makeOrg(slug, name) {
      const org = await admin.query(
        `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ($1, $2, '31') RETURNING id`,
        [slug, name],
      );
      const site = await admin.query(
        `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site') RETURNING id`,
        [org.rows[0].id],
      );
      const room = await admin.query(
        `INSERT INTO rooms (organization_id, site_id, name_fr, max_capacity) VALUES ($1, $2, 'Bébés', 15) RETURNING id`,
        [org.rows[0].id, site.rows[0].id],
      );
      const dir = await admin.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'Directrice', 'D', $2, 'active') RETURNING id`,
        [`p6.dir.${slug}@test.dz`, hash],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [org.rows[0].id, dir.rows[0].id, directorRole.rows[0].id],
      );
      const edu = await admin.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'Éducatrice', 'E', $2, 'active') RETURNING id`,
        [`p6.edu.${slug}@test.dz`, hash],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [org.rows[0].id, edu.rows[0].id, educatorRole.rows[0].id],
      );
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, edu: edu.rows[0].id };
    }
    const A = await makeOrg('p6-a', 'Crèche P6 A');
    const B = await makeOrg('p6-b', 'Crèche P6 B');

    const loginA = await api('POST', '/auth/login', null, { email: 'p6.dir.p6-a@test.dz', password });
    const tokenA = loginA.body.access_token;
    const loginEdu = await api('POST', '/auth/login', null, { email: 'p6.edu.p6-a@test.dz', password });
    const eduToken = loginEdu.body.access_token;
    const loginB = await api('POST', '/auth/login', null, { email: 'p6.dir.p6-b@test.dz', password });
    const tokenB = loginB.body.access_token;

    async function makeChild(token, org, room, first, last) {
      const res = await api('POST', '/children', token, {
        site_id: org.site, room_id: room, first_name_fr: first, last_name_fr: last,
        date_of_birth: '2024-02-10',
      });
      return res.body.id;
    }
    const childA = await makeChild(tokenA, A, A.room, 'Yanis', 'Amrani');
    const childB = await makeChild(tokenB, B, B.room, 'Brahim', 'Benali');

    // Gardien avec can_receive_push + lien (+ user parent pour les notifications)
    const parentUser = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('p6.parent@test.dz', 'Salima', 'Parent', $1, 'active') RETURNING id`,
      [hash],
    );
    const guardian = await api('POST', '/children/guardians', tokenA, {
      first_name_fr: 'Salima', last_name_fr: 'Amrani', relationship: 'mother',
      phone_primary: '0550123456', email: 'salima@test.dz', user_id: parentUser.rows[0].id,
    });
    await api('POST', `/children/${childA}/guardians`, tokenA, {
      guardian_id: guardian.body.id, is_primary: true, can_receive_push: true,
    });

    const device = await api('POST', '/devices', tokenA, {
      name: 'Tablette', device_fingerprint: 'fp-p6-tablette-abcdef', platform: 'android',
    });

    // ── 1. Journal HTTP ─────────────────────────────────────────────────────
    console.log('\n1) Journal quotidien (HTTP)');
    const meal = await api('POST', '/journal/events', tokenA, {
      child_id: childA, event_type: 'meal', meal_type: 'lunch', meal_quantity: 'all',
    });
    check('Événement repas → 201', meal.status === 201 && meal.body.id, `status=${meal.status}`);
    const summary = await admin.query(
      `SELECT meal_count, diaper_count FROM daily_summaries
       WHERE child_id = $1 AND summary_date = (SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date)`,
      [childA],
    );
    check('Agrégat : meal_count = 1', summary.rows.length === 1 && summary.rows[0].meal_count === 1);

    const privateNote = await api('POST', '/journal/events', tokenA, {
      child_id: childA, event_type: 'note', note_text: 'note interne', note_is_private: true,
    });
    check('Note privée → 201', privateNote.status === 201);
    const feed = await api('GET', `/journal/feed?child_id=${childA}`, tokenA);
    check('Fil parent : note privée absente', !feed.body.items.some((e) => e.event_type === 'note'));

    const incident = await api('POST', '/journal/events', tokenA, {
      child_id: childA, event_type: 'incident', incident_severity: 'serious',
      incident_description: 'Chute dans la cour',
    });
    check('Incident → 201', incident.status === 201);
    const notifs = await admin.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id = $1`,
      [A.org],
    );
    check('Incident → notification parent en file', notifs.rows[0].n >= 1, `n=${notifs.rows[0].n}`);
    const inbox = await admin.query(
      `SELECT COUNT(*)::int AS n FROM notification_inbox WHERE organization_id = $1`,
      [A.org],
    );
    check('Incident → notification_inbox parent', inbox.rows[0].n >= 1);

    // Correction append-only
    const wrongMeal = await api('POST', '/journal/events', tokenA, {
      child_id: childA, event_type: 'meal', meal_type: 'lunch', meal_quantity: 'half',
    });
    const correction = await api('POST', '/journal/events', tokenA, {
      child_id: childA, event_type: 'meal', meal_type: 'lunch', meal_quantity: 'good',
      corrects_event_id: wrongMeal.body.id, correction_reason: 'quantité erronée',
    });
    check('Correction → nouvel événement is_correction', correction.status === 201);
    const events = await api('GET', `/journal/events?child_id=${childA}`, tokenA);
    const wrongEvt = events.body.items.find((e) => e.id === wrongMeal.body.id);
    const corrEvt = events.body.items.find((e) => e.corrects_event_id === wrongMeal.body.id);
    check('Correction : événement d\'origine inchangé, correction liée',
      wrongEvt && wrongEvt.meal_quantity === 'half'
      && corrEvt && corrEvt.is_correction === true && corrEvt.correction_reason === 'quantité erronée');

    // ── 2. Action groupée ───────────────────────────────────────────────────
    console.log('\n2) Action groupée (repas de section)');
    const groupChildren = [];
    for (let i = 0; i < 12; i += 1) {
      groupChildren.push(await makeChild(tokenA, A, A.room, `Enfant${i}`, 'Group'));
    }
    const group = await api('POST', '/journal/group-actions', tokenA, {
      event_type: 'meal', meal_type: 'snack', meal_quantity: 'good',
      children: groupChildren.map((id) => ({ child_id: id })),
    });
    check('Repas groupé 12 enfants → 12 événements', group.status === 201 && group.body.count === 12,
      `status=${group.status} ${JSON.stringify(group.body)?.slice(0, 120)}`);
    const groupCount = await admin.query(
      `SELECT COUNT(*)::int AS n FROM daily_log_events WHERE child_id = ANY($1::uuid[]) AND event_type = 'meal'`,
      [groupChildren],
    );
    check('Base : 12 repas groupés', groupCount.rows[0].n === 12);

    // ── 3. Médias ───────────────────────────────────────────────────────────
    console.log('\n3) Médias (presign, consentements, journalisation)');
    const presign = await api('POST', '/media/presign-upload', tokenA, {
      filename: 'photo1.jpg', mime_type: 'image/jpeg', child_id: childA,
    });
    check('Presign upload → URL signée S3', presign.status === 201
      && presign.body.upload_url?.includes('X-Amz-Signature')
      && presign.body.storage_key?.startsWith(`${A.org}/photo/`),
      JSON.stringify(presign.body));

    const reg = await api('POST', '/media', tokenA, {
      storage_key: presign.body.storage_key, mime_type: 'image/jpeg',
      child_id: childA, children_in_photo: [childA],
      original_filename: 'photo1.jpg', file_size_bytes: 150000, exif_stripped: true,
    });
    check('Register asset → 201, non visible par défaut', reg.status === 201
      && reg.body.id && reg.body.is_visible_to_parents === false,
      `status=${reg.status} ${JSON.stringify(reg.body)}`);

    const noConsent = await api('PATCH', `/media/${reg.body.id}/visibility`, tokenA, {
      is_visible_to_parents: true,
    });
    check('Visibilité sans consentement → 422 CONSENT_REQUIRED',
      noConsent.status === 422 && noConsent.body.code === 'CONSENT_REQUIRED');

    // Consentement photo_individual (via SQL — module privacy Phase 7+)
    await admin.query(
      `INSERT INTO consent_records (organization_id, guardian_id, child_id, consent_type, granted, granted_at, collection_method)
       VALUES ($1, $2, $3, 'photo_individual', true, NOW(), 'test')`,
      [A.org, guardian.body.id, childA],
    );
    const withConsent = await api('PATCH', `/media/${reg.body.id}/visibility`, tokenA, {
      is_visible_to_parents: true,
    });
    check('Visibilité avec consentement → 200 visible', withConsent.status === 200
      && withConsent.body.is_visible_to_parents === true);

    const download = await api('GET', `/media/${reg.body.id}/download`, tokenA);
    check('Download → URL signée + journalisée', download.status === 200
      && download.body.url.includes('X-Amz-Signature'));
    const accessLogs = await admin.query(
      `SELECT COUNT(*)::int AS n FROM media_access_logs WHERE media_id = $1`,
      [reg.body.id],
    );
    check('Accès média journalisé (loi 25-11)', accessLogs.rows[0].n >= 1);

    const crossRead = await api('GET', `/media/${reg.body.id}`, tokenB);
    const crossDownload = await api('GET', `/media/${reg.body.id}/download`, tokenB);
    check('Cross-tenant : B lit le média de A → 404', crossRead.status === 404 && crossDownload.status === 404,
      `read=${crossRead.status} dl=${crossDownload.status}`);

    const eduPublish = await api('PATCH', `/media/${reg.body.id}/visibility`, eduToken, {
      is_visible_to_parents: false,
    });
    check('Éducatrice ne publie pas → 403', eduPublish.status === 403);

    // Consentement révoqué → nouvelle publication refusée
    await admin.query(
      `UPDATE consent_records SET revoked_at = NOW() WHERE child_id = $1 AND consent_type = 'photo_individual'`,
      [childA],
    );
    const reg2 = await api('POST', '/media', tokenA, {
      storage_key: `${A.org}/photo/revoked-test.jpg`, mime_type: 'image/jpeg',
      child_id: childA, children_in_photo: [childA],
    });
    const revokedPublish = await api('PATCH', `/media/${reg2.body.id}/visibility`, tokenA, {
      is_visible_to_parents: true,
    });
    check('Consentement révoqué → 422 (publication refusée)',
      revokedPublish.status === 422 && revokedPublish.body.code === 'CONSENT_REQUIRED');

    // ── 4. Sync : add_photo + log_incident ──────────────────────────────────
    console.log('\n4) Sync — photos et incidents offline');
    const photoSync = await api('POST', '/sync/push', tokenA, {
      device_id: device.body.device_id,
      operations: [{
        event_id: randomUUID(), client_sequence: 1, schema_version: 1,
        command: 'add_photo', entity_type: 'media',
        payload: {
          child_id: childA, storage_key: `${A.org}/photo/offline-1.jpg`,
          mime_type: 'image/jpeg', checksum: 'abc123',
        },
        occurred_at_device: new Date().toISOString(),
      }],
    });
    check('add_photo sync → accepted', photoSync.status === 200 && photoSync.body.accepted.length === 1,
      JSON.stringify(photoSync.body));
    const offlineMedia = await admin.query(
      `SELECT is_visible_to_parents FROM media_assets WHERE storage_key = $1`,
      [`${A.org}/photo/offline-1.jpg`],
    );
    check('Photo offline enregistrée, non visible', offlineMedia.rows.length === 1
      && offlineMedia.rows[0].is_visible_to_parents === false);

    const incidentSync = await api('POST', '/sync/push', tokenA, {
      device_id: device.body.device_id,
      operations: [{
        event_id: randomUUID(), client_sequence: 2, schema_version: 1,
        command: 'log_incident', entity_type: 'daily_log',
        payload: { child_id: childA, incident_severity: 'moderate', incident_description: 'Bleu au genou' },
        occurred_at_device: new Date().toISOString(),
      }],
    });
    check('log_incident sync → accepted', incidentSync.status === 200 && incidentSync.body.accepted.length === 1);
    const notifsAfter = await admin.query(
      `SELECT COUNT(*)::int AS n FROM notification_inbox WHERE organization_id = $1`,
      [A.org],
    );
    check('Incident offline → notification parent', notifsAfter.rows[0].n >= 2, `n=${notifsAfter.rows[0].n}`);

    // ── 5. Notifications check_in (file + inbox) ────────────────────────────
    console.log('\n5) Notifications (check_in → file + inbox)');
    const checkInNotif = await api('POST', '/attendance/check-in', tokenA, { child_id: childA });
    check('Check-in HTTP → 201', checkInNotif.status === 201);
    const inboxRows = await admin.query(
      `SELECT type, body_fr FROM notification_inbox WHERE organization_id = $1 AND type = 'check_in' ORDER BY created_at DESC LIMIT 1`,
      [A.org],
    );
    check('Inbox : notification check_in avec prénom', inboxRows.rows.length === 1
      && inboxRows.rows[0].body_fr.includes('Yanis'));

    // ── 6. Worker ───────────────────────────────────────────────────────────
    console.log('\n6) Worker (jobs + drain notifications)');
    const worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: REPO,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 4000));
    worker.kill();
    const jobs = await admin.query(
      `SELECT status FROM background_jobs WHERE organization_id = $1 AND job_type = 'send_parent_notification'`,
      [A.org],
    );
    check('Worker : job send_parent_notification → done', jobs.rows.length >= 1
      && jobs.rows.every((j) => j.status === 'done'),
      JSON.stringify(jobs.rows));
    const queue = await admin.query(
      `SELECT DISTINCT status FROM notification_queue WHERE organization_id = $1`,
      [A.org],
    );
    check('Worker : notification_queue drainée (sent)', queue.rows.length === 1 && queue.rows[0].status === 'sent',
      JSON.stringify(queue.rows));

    // ── 7. Stress 60 opérations offline mixtes ──────────────────────────────
    console.log('\n7) Stress : 60 opérations offline mixtes');
    const ops = [];
    for (let i = 0; i < 20; i += 1) {
      ops.push({
        event_id: randomUUID(), client_sequence: 100 + i, schema_version: 1,
        command: 'log_meal', entity_type: 'daily_log',
        payload: { child_id: childA, meal_type: 'snack', meal_quantity: 'good' },
        occurred_at_device: new Date().toISOString(),
      });
      ops.push({
        event_id: randomUUID(), client_sequence: 200 + i, schema_version: 1,
        command: 'log_diaper', entity_type: 'daily_log',
        payload: { child_id: childA, diaper_type: 'wet' },
        occurred_at_device: new Date().toISOString(),
      });
      ops.push({
        event_id: randomUUID(), client_sequence: 300 + i, schema_version: 1,
        command: 'log_temperature', entity_type: 'daily_log',
        payload: { child_id: childA, temperature_celsius: 36.8 },
        occurred_at_device: new Date().toISOString(),
      });
    }
    const stress = await api('POST', '/sync/push', tokenA, { device_id: device.body.device_id, operations: ops });
    check('60 opérations → toutes accepted', stress.status === 200 && stress.body.accepted.length === 60,
      `accepted=${stress.body.accepted.length}`);
    const agg = await admin.query(
      `SELECT meal_count, diaper_count FROM daily_summaries
       WHERE child_id = $1 AND summary_date = (SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date)`,
      [childA],
    );
    check('Agrégats childA exacts (meal=22, diaper=20)', agg.rows.length === 1
      && agg.rows[0].meal_count === 22 && agg.rows[0].diaper_count === 20,
      JSON.stringify(agg.rows));
    const groupAgg = await admin.query(
      `SELECT COUNT(*)::int AS n FROM daily_summaries
       WHERE child_id = ANY($1::uuid[]) AND meal_count = 1`,
      [groupChildren],
    );
    check('Agrégats des 12 enfants du repas groupé', groupAgg.rows[0].n === 12,
      `n=${groupAgg.rows[0].n}`);

    // ── Nettoyage (ordre dépendant des FK) ──────────────────────────────────
    const orgIds = `(SELECT id FROM organizations WHERE slug LIKE 'p6-%')`;
    await admin.query(`DELETE FROM sync_operations WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sync_cursors WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sync_changelog WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM media_access_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM media_assets WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM notification_queue WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM notification_inbox WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM background_jobs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM consent_records WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM daily_log_events WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM daily_summaries WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM attendance_events WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM attendance_sessions WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM data_access_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p6.%@test.dz')`);
    await admin.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p6.%@test.dz')`);
    await admin.query(`DELETE FROM devices WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM child_guardians WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM room_moves WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM child_status_history WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM children WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM guardians WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM org_sequences WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM memberships WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM users WHERE email LIKE 'p6.%@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'p6-%'`);
  } finally {
    await app.close();
    await admin.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} test(s) en échec.`);
    process.exit(1);
  }
  console.log('✓ Phase 6 validée : journal, médias, consentements, notifications, worker.');
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.stack ?? error.message);
  process.exit(1);
});
