#!/usr/bin/env node
/**
 * Test API — Phase 5 (présences + synchronisation offline).
 *
 * Prérequis : apps/api compilé (dist/) et DATABASE_URL valide.
 * Vérifie :
 *  1. Machine à états : check-in/check-out/mark-absent + transitions illégales
 *  2. Résumé présences par salle
 *  3. Sync push : accepted, idempotence (10× = 1 résultat), heure appareil
 *  4. Sync cross-tenant : enfant de B poussé par A → PERMISSION_DENIED
 *  5. Appareil révoqué → DEVICE_REVOKED ; commande inconnue → UNKNOWN_COMMAND
 *  6. Journal offline (log_meal…) → daily_log_events + agrégats
 *  7. Sync pull : curseur monotone, isolation (A ne reçoit pas les events de B)
 *  8. Stress : 200 opérations offline → toutes acceptées, pull complet
 *  9. Curseurs indépendants par appareil
 *
 * Usage : node tests/tenant-isolation/phase5.api.test.mjs
 */
import { execSync } from 'node:child_process';
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
    // ── Setup : orgs A/B + director + devices + enfants ────────────────────
    const password = 'Password123!';
    const hash = await bcrypt.hash(password, 12);
    const directorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'director'`);

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
        `INSERT INTO rooms (organization_id, site_id, name_fr, max_capacity)
         VALUES ($1, $2, 'Bébés', 12) RETURNING id`,
        [org.rows[0].id, site.rows[0].id],
      );
      const user = await admin.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'Directrice', 'D', $2, 'active') RETURNING id`,
        [`p5.dir.${slug}@test.dz`, hash],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [org.rows[0].id, user.rows[0].id, directorRole.rows[0].id],
      );
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id };
    }

    const A = await makeOrg('p5-a', 'Crèche P5 A');
    const B = await makeOrg('p5-b', 'Crèche P5 B');

    const loginA = await api('POST', '/auth/login', null, { email: 'p5.dir.p5-a@test.dz', password });
    const tokenA = loginA.body.access_token;
    const loginB = await api('POST', '/auth/login', null, { email: 'p5.dir.p5-b@test.dz', password });
    const tokenB = loginB.body.access_token;

    async function makeChild(token, org, room, first, last) {
      const res = await api('POST', '/children', token, {
        site_id: org.site,
        room_id: room,
        first_name_fr: first,
        last_name_fr: last,
        date_of_birth: '2024-01-15',
      });
      return res.body.id;
    }
    const childA1 = await makeChild(tokenA, A, A.room, 'Yanis', 'Amrani');
    const childA2 = await makeChild(tokenA, A, A.room, 'Lina', 'Amrani');
    const childA3 = await makeChild(tokenA, A, A.room, 'Adam', 'Amrani');
    const childB1 = await makeChild(tokenB, B, B.room, 'Brahim', 'Benali');

    async function registerDevice(token, name, fingerprint) {
      const res = await api('POST', '/devices', token, {
        name,
        device_fingerprint: fingerprint,
        platform: 'android',
        app_version: '0.1.0',
      });
      return res.body.device_id;
    }
    const devA1 = await registerDevice(tokenA, 'Tablette A1', 'fp-p5-a1-abcdef');
    const devA2 = await registerDevice(tokenA, 'Tablette A2', 'fp-p5-a2-abcdef');
    const devB1 = await registerDevice(tokenB, 'Tablette B1', 'fp-p5-b1-abcdef');

    // ── 1. Machine à états (HTTP) ───────────────────────────────────────────
    console.log('\n1) Machine à états de présence');
    const checkIn = await api('POST', '/attendance/check-in', tokenA, { child_id: childA1 });
    check('Check-in HTTP → session present', checkIn.status === 201 && checkIn.body.status === 'present',
      JSON.stringify(checkIn.body));

    const doubleCheckIn = await api('POST', '/attendance/check-in', tokenA, { child_id: childA1 });
    check('Double check-in → 409 INVALID_STATE_TRANSITION',
      doubleCheckIn.status === 409 && doubleCheckIn.body.code === 'INVALID_STATE_TRANSITION');

    const checkOut = await api('POST', '/attendance/check-out', tokenA, { child_id: childA1 });
    check('Check-out → departed', checkOut.status === 201 && checkOut.body.status === 'departed');

    const doubleCheckOut = await api('POST', '/attendance/check-out', tokenA, { child_id: childA1 });
    check('Check-out après departed → 409', doubleCheckOut.status === 409);

    const markAbsent = await api('POST', '/attendance/mark-absent', tokenA, { child_id: childA2, reason: 'malade' });
    check('Mark-absent → absent', markAbsent.status === 201 && markAbsent.body.status === 'absent');

    const lateArrival = await api('POST', '/attendance/check-in', tokenA, { child_id: childA2 });
    check('Arrivée tardive depuis absent → present', lateArrival.status === 201 && lateArrival.body.status === 'present');

    const summary = await api('GET', `/attendance/summary?room_id=${A.room}`, tokenA);
    check('Résumé salle → 3 enfants, statuts corrects', summary.status === 200
      && summary.body.items.length === 3
      && summary.body.items.some((i) => i.child_id === childA1 && i.status === 'departed')
      && summary.body.items.some((i) => i.child_id === childA2 && i.status === 'present')
      && summary.body.items.some((i) => i.child_id === childA3 && i.status === 'expected'),
      JSON.stringify(summary.body?.items?.map((i) => ({ id: i.child_id, st: i.status }))));

    // Correction tracée
    const correct = await api('POST', '/attendance/correct', tokenA, {
      child_id: childA1,
      action: 'check_in',
      reason: 'Départ enregistré par erreur',
    });
    check('Correction → present (tracée)', correct.status === 201 && correct.body.status === 'present',
      `status=${correct.status} ${JSON.stringify(correct.body)}`);

    // ── 2. Sync push — idempotence ──────────────────────────────────────────
    console.log('\n2) Sync push — idempotence');
    const eventId = randomUUID();
    const op = (childId, ev = eventId, extra = {}) => ({
      operations: [{
        event_id: ev,
        client_sequence: 1,
        schema_version: 1,
        command: 'check_in',
        entity_type: 'attendance_session',
        payload: { child_id: childId, site_id: A.site, ...extra },
        occurred_at_device: new Date().toISOString(),
      }],
    });

    const first = await api('POST', '/sync/push', tokenA, { device_id: devA1, ...op(childA3) });
    check('Push check-in (offline) → accepted', first.status === 200
      && first.body.accepted.length === 1, JSON.stringify(first.body));

    for (let i = 0; i < 9; i += 1) {
      await api('POST', '/sync/push', tokenA, { device_id: devA1, ...op(childA3) });
    }
    const eventsCount = await admin.query(
      `SELECT COUNT(*)::int AS n FROM attendance_events WHERE sync_event_id = $1`,
      [eventId],
    );
    check('Idempotence : même event_id 10× → 1 événement', eventsCount.rows[0].n === 1,
      `n=${eventsCount.rows[0].n}`);

    // ── 3. Sync cross-tenant + sécurité ─────────────────────────────────────
    console.log('\n3) Sécurité sync (cross-tenant, appareils, commandes)');
    const crossTenant = await api('POST', '/sync/push', tokenA, {
      device_id: devA1,
      operations: [{
        event_id: randomUUID(),
        client_sequence: 2,
        schema_version: 1,
        command: 'check_in',
        entity_type: 'attendance_session',
        payload: { child_id: childB1, site_id: B.site },
        occurred_at_device: new Date().toISOString(),
      }],
    });
    check('Enfant de B poussé par A → rejected PERMISSION_DENIED',
      crossTenant.status === 200
      && crossTenant.body.rejected[0]?.reason === 'PERMISSION_DENIED',
      JSON.stringify(crossTenant.body));
    const sessionB = await admin.query(
      `SELECT COUNT(*)::int AS n FROM attendance_sessions WHERE child_id = $1`,
      [childB1],
    );
    check('Aucune session créée pour l\'enfant de B', sessionB.rows[0].n === 0);

    // Appareil révoqué
    await api('POST', `/devices/${devA2}/revoke`, tokenA);
    const revokedDevice = await api('POST', '/sync/push', tokenA, {
      device_id: devA2,
      operations: [{
        event_id: randomUUID(),
        client_sequence: 1,
        schema_version: 1,
        command: 'log_note',
        entity_type: 'daily_log',
        payload: { child_id: childA1, note_text: 'test' },
        occurred_at_device: new Date().toISOString(),
      }],
    });
    check('Appareil révoqué → DEVICE_REVOKED', revokedDevice.status === 200
      && revokedDevice.body.rejected[0]?.reason === 'DEVICE_REVOKED');

    // Heure appareil dans le futur
    const futureOp = await api('POST', '/sync/push', tokenA, {
      device_id: devA1,
      operations: [{
        event_id: randomUUID(),
        client_sequence: 1,
        schema_version: 1,
        command: 'log_note',
        entity_type: 'daily_log',
        payload: { child_id: childA1, note_text: 'futur' },
        occurred_at_device: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }],
    });
    check('Heure appareil dans le futur → DEVICE_TIME_AHEAD',
      futureOp.status === 200 && futureOp.body.rejected[0]?.reason === 'DEVICE_TIME_AHEAD');

    // Commande inconnue + add_photo (Phase 6)
    const unknownCmd = await api('POST', '/sync/push', tokenA, {
      device_id: devA1,
      operations: [
        {
          event_id: randomUUID(), client_sequence: 1, schema_version: 1,
          command: 'commande_inexistante', entity_type: 'x', payload: {},
          occurred_at_device: new Date().toISOString(),
        },
        {
          event_id: randomUUID(), client_sequence: 2, schema_version: 1,
          command: 'add_photo', entity_type: 'media', payload: { child_id: childA1 },
          occurred_at_device: new Date().toISOString(),
        },
      ],
    });
    check('Commande inconnue → UNKNOWN_COMMAND', unknownCmd.status === 200
      && (unknownCmd.body.rejected ?? []).some((r) => r.reason === 'UNKNOWN_COMMAND'),
      `status=${unknownCmd.status} ${JSON.stringify(unknownCmd.body)?.slice(0, 200)}`);
    check('add_photo → NOT_IMPLEMENTED (Phase 6)', (unknownCmd.body.rejected ?? []).some((r) => r.reason === 'NOT_IMPLEMENTED'));

    // ── 4. Journal offline (log_*) ──────────────────────────────────────────
    console.log('\n4) Journal quotidien offline');
    const mealOps = await api('POST', '/sync/push', tokenA, {
      device_id: devA1,
      operations: [
        {
          event_id: randomUUID(), client_sequence: 1, schema_version: 1,
          command: 'log_meal', entity_type: 'daily_log',
          payload: { child_id: childA2, meal_type: 'lunch', meal_quantity: 'all' },
          occurred_at_device: new Date().toISOString(),
        },
        {
          event_id: randomUUID(), client_sequence: 2, schema_version: 1,
          command: 'log_diaper', entity_type: 'daily_log',
          payload: { child_id: childA2, diaper_type: 'wet' },
          occurred_at_device: new Date().toISOString(),
        },
        {
          event_id: randomUUID(), client_sequence: 3, schema_version: 1,
          command: 'log_nap_start', entity_type: 'daily_log',
          payload: { child_id: childA2, nap_start_at: new Date().toISOString() },
          occurred_at_device: new Date().toISOString(),
        },
      ],
    });
    check('3 événements journal → tous accepted', mealOps.status === 200
      && mealOps.body.accepted.length === 3, JSON.stringify(mealOps.body));
    const summaryAgg = await admin.query(
      `SELECT meal_count, diaper_count FROM daily_summaries
       WHERE child_id = $1 AND summary_date = (SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date)`,
      [childA2],
    );
    check('Agrégats journal → meal=1, diaper=1',
      summaryAgg.rows.length === 1 && summaryAgg.rows[0].meal_count === 1 && summaryAgg.rows[0].diaper_count === 1,
      JSON.stringify(summaryAgg.rows));

    // ── 5. Sync pull ────────────────────────────────────────────────────────
    console.log('\n5) Sync pull (curseur, isolation)');
    const pull0 = await api('GET', `/sync/pull?cursor=0&device_id=${devA1}`, tokenA);
    check('Pull(0) → événements + next_cursor > 0', pull0.status === 200
      && pull0.body.events.length > 0 && pull0.body.next_cursor > 0,
      JSON.stringify(pull0.body)?.slice(0, 200));
    check('Pull A : aucun événement de l\'org B', !pull0.body.events.some((e) => {
      const p = e.payload ?? {};
      return p.child_id === childB1;
    }));

    const pullNext = await api('GET', `/sync/pull?cursor=${pull0.body.next_cursor}&device_id=${devA1}`, tokenA);
    check('Pull(cursor) → rien de nouveau (vide ou seq > cursor)',
      pullNext.status === 200 && pullNext.body.events.every((e) => e.sync_seq > pull0.body.next_cursor));

    // Isolation : B ne voit que ses événements
    const pullB = await api('GET', `/sync/pull?cursor=0&device_id=${devB1}`, tokenB);
    check('Pull B → aucun événement de A', pullB.status === 200
      && !pullB.body.events.some((e) => (e.payload ?? {}).child_id === childA1 || (e.payload ?? {}).child_id === childA2));

    // Curseurs indépendants par appareil
    const pullDevA2 = await api('GET', `/sync/pull?cursor=0&device_id=${devA1}`, tokenA);
    const cursorA = pullDevA2.body.next_cursor;
    const pullFreshDevice = await api('GET', `/sync/pull?cursor=0&device_id=${devA1}`, tokenA);
    check('Pull depuis 0 → même état (curseur par appareil, idempotent)',
      pullFreshDevice.body.next_cursor === cursorA);

    // ── 6. Stress : 200 opérations offline ──────────────────────────────────
    console.log('\n6) Stress : 200 opérations offline');
    const ops200 = [];
    for (let i = 0; i < 100; i += 1) {
      ops200.push({
        event_id: randomUUID(), client_sequence: 100 + i, schema_version: 1,
        command: 'log_meal', entity_type: 'daily_log',
        payload: { child_id: childA2, meal_type: i % 2 === 0 ? 'lunch' : 'snack', meal_quantity: 'good' },
        occurred_at_device: new Date().toISOString(),
      });
      ops200.push({
        event_id: randomUUID(), client_sequence: 200 + i, schema_version: 1,
        command: 'log_diaper', entity_type: 'daily_log',
        payload: { child_id: childA2, diaper_type: i % 3 === 0 ? 'dirty' : 'wet' },
        occurred_at_device: new Date().toISOString(),
      });
    }
    const batch = await api('POST', '/sync/push', tokenA, { device_id: devA1, operations: ops200 });
    check('200 opérations → toutes accepted', batch.status === 200 && batch.body.accepted.length === 200,
      `accepted=${batch.body.accepted.length} rejected=${batch.body.rejected.length}`);

    const dailyCount = await admin.query(
      `SELECT COUNT(*)::int AS n FROM daily_log_events WHERE child_id = $1 AND sync_event_id IS NOT NULL`,
      [childA2],
    );
    check('Base cohérente : 203 événements journal (3 + 200)', dailyCount.rows[0].n === 203,
      `n=${dailyCount.rows[0].n}`);

    // Pull par lots de 500 : tout est récupérable
    let cursor = 0;
    let totalPulled = 0;
    let batches = 0;
    while (true) {
      const p = await api('GET', `/sync/pull?cursor=${cursor}&device_id=${devA1}`, tokenA);
      totalPulled += p.body.events.length;
      batches += 1;
      if (p.body.events.length === 0 || p.body.next_cursor === cursor) break;
      cursor = p.body.next_cursor;
    }
    const changelogCount = await admin.query(
      `SELECT COUNT(*)::int AS n FROM sync_changelog WHERE organization_id = $1`,
      [A.org],
    );
    check('Pull paginé : tout le changelog récupéré', totalPulled === changelogCount.rows[0].n,
      `pulled=${totalPulled} changelog=${changelogCount.rows[0].n} batches=${batches}`);

    // ── Nettoyage (ordre dépendant des FK) ─────────────────────────────────
    const orgIds = `(SELECT id FROM organizations WHERE slug LIKE 'p5-%')`;
    await admin.query(`DELETE FROM sync_operations WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sync_cursors WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sync_changelog WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM attendance_events WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM attendance_sessions WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM daily_log_events WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM daily_summaries WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM background_jobs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM data_access_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p5.%@test.dz')`);
    await admin.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p5.%@test.dz')`);
    await admin.query(`DELETE FROM devices WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM child_guardians WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM room_moves WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM child_status_history WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM children WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM org_sequences WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM memberships WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM users WHERE email LIKE 'p5.%@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'p5-%'`);
  } finally {
    await app.close();
    await admin.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} test(s) en échec.`);
    process.exit(1);
  }
  console.log('✓ Phase 5 validée : présences offline, sync idempotente, isolation.');
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.stack ?? error.message);
  process.exit(1);
});
