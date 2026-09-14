#!/usr/bin/env node
/** F3a: real HTTP/PG outcomes, conflicts before effects, replay and commit failure.
 * Synthetic fixtures only; no reset here. Not the Dart -> API F4 gate.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';
import { assertSchema } from '../contracts/schema-validator.mjs';

const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
let app, pool;
let passed = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}: ${error.stack}`); }
}
try {
  await ensureAppRole(db);
  const suffix = randomUUID();
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'F3 Test','31') RETURNING id", [`f3-${suffix}`])).rows[0].id;
  const email = `f3-${suffix}@test.dz`;
  const user = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F3','Test',$2,'active') RETURNING id", [email, await bcrypt.hash('Password123!', 4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, user]);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F3 Site') RETURNING id", [org])).rows[0].id;
  const apiUrl = new URL(appUrl());
  const applicationName = `f3-${suffix}`;
  apiUrl.searchParams.set('application_name', applicationName);
  process.env.DATABASE_URL = apiUrl.toString();
  process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  async function req(method, path, body) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const response = await r.json();
    if (r.status >= 400) assertSchema('ErrorResponse', response);
    else if (path === '/sync/push') assertSchema('PushResponse', response);
    return { status: r.status, body: response };
  }
  token = (await req('POST', '/auth/login', { email, password: 'Password123!' })).body.access_token;
  assert.ok(token);
  const register = async () => (await req('POST', '/devices', { name: 'F3 device', device_fingerprint: randomUUID(), platform: 'android' })).body.device_id;
  const device = await register();
  const secondDevice = await register();
  assert.ok(device && secondDevice);
  let sequence = 0;
  const operation = (child, extra = {}) => ({ event_id: randomUUID(), client_sequence: ++sequence, schema_version: 1, command: 'correct_attendance', entity_type: 'attendance', payload: { child_id: child, action: 'check_out', reason: 'Synthetic correction' }, occurred_at_device: new Date().toISOString(), ...extra });
  async function push(op, deviceId = device) {
    const r = await req('POST', '/sync/push', { device_id: deviceId, operations: [op] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  const outcome = ({ accepted, rejected, conflicts }) => ({ accepted, rejected, conflicts });
  async function child(withSession = true) {
    const r = await req('POST', '/children', { site_id: site, first_name_fr: 'Synthetic', last_name_fr: 'F3', date_of_birth: '2024-01-01', status: 'active' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (withSession) {
      const p = await push(operation(r.body.id, { command: 'check_in', payload: { child_id: r.body.id } }));
      assert.equal(p.accepted.length, 1, JSON.stringify(p));
    }
    return r.body.id;
  }
  const session = async id => (await db.query('SELECT id,status,version FROM attendance_sessions WHERE child_id=$1', [id])).rows[0];
  async function effects(id) {
    const counts = {};
    // Count all tenant effects, not just a status/version, including notification queues.
    for (const table of ['attendance_events', 'daily_log_events', 'sync_changelog', 'background_jobs', 'notification_queue', 'notification_inbox']) {
      counts[table] = (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1`, [org])).rows[0].n;
    }
    return { session: await session(id), counts };
  }
  async function noRecordedOperation(id) {
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sync_operations WHERE event_id=$1', [id])).rows[0].n, 0);
  }

  await check('matching base version is accepted once, not checked after increment', async () => {
    const id = await child(); const before = await session(id);
    const op = operation(id, { base_version: before.version });
    const r = await push(op);
    assert.deepEqual(outcome(r), { accepted: [op.event_id], rejected: [], conflicts: [] });
    assert.equal((await session(id)).version, before.version + 1);
    assert.equal((await session(id)).status, 'departed');
    const after = await effects(id);
    assert.deepEqual(outcome(await push(op)), outcome(r));
    assert.deepEqual(await effects(id), after);
  });
  await check('stale correction is a conflict with NO business/changelog/notification effects', async () => {
    const id = await child(); const before = await effects(id);
    const op = operation(id, { base_version: 0 }); const r = await push(op);
    assert.deepEqual(await effects(id), before);
    assert.deepEqual(outcome(r), { accepted: [], rejected: [], conflicts: [{ event_id: op.event_id, reason: 'VERSION_MISMATCH', current_version: before.session.version }] });
  });
  await check('conflict replay retains the original version after later writes', async () => {
    const id = await child(); const op = operation(id, { base_version: 0 });
    const first = await push(op);
    await push(operation(id));
    const before = await effects(id);
    assert.deepEqual(outcome(await push(op)), outcome(first));
    assert.deepEqual(await effects(id), before);
  });
  await check('missing session with nonzero base conflicts at version 0 without creating it', async () => {
    const id = await child(false); const before = await effects(id); const op = operation(id, { base_version: 5 });
    const r = await push(op);
    assert.deepEqual(await effects(id), before);
    assert.deepEqual(r.conflicts, [{ event_id: op.event_id, reason: 'VERSION_MISMATCH', current_version: 0 }]);
  });
  await check('missing session with base 0 may be created', async () => {
    const id = await child(false); const op = operation(id, { base_version: 0 });
    assert.deepEqual((await push(op)).accepted, [op.event_id]);
    assert.equal((await session(id)).version, 1);
  });
  await check('null base version means unversioned correction, as in the wire contract', async () => {
    const id = await child(); const op = operation(id, { base_version: null });
    assert.deepEqual((await push(op)).accepted, [op.event_id]);
  });
  await check('business rejection replay retains the same reason and message', async () => {
    const id = await child(); const op = operation(id, { command: 'check_in' });
    const first = await push(op); assert.equal(first.rejected[0]?.reason, 'INVALID_STATE_TRANSITION');
    const before = await effects(id);
    assert.deepEqual(outcome(await push(op)), outcome(first));
    assert.deepEqual(await effects(id), before);
  });
  await check('simultaneous corrections of the same version: one accepted, one conflict, one mutation', async () => {
    const id = await child(); const before = await effects(id);
    const results = await Promise.all([push(operation(id, { base_version: 1 })), push(operation(id, { base_version: 1 }))]);
    assert.equal(results.flatMap(r => r.accepted).length, 1);
    assert.equal(results.flatMap(r => r.conflicts).length, 1);
    assert.equal(results.flatMap(r => r.rejected).length, 0);
    assert.equal((await session(id)).version, 2);
    const after = await effects(id);
    assert.equal(after.counts.attendance_events, before.counts.attendance_events + 1);
    assert.equal(after.counts.sync_changelog, before.counts.sync_changelog + 1);
  });
  await check('six in-flight retries of one event return one committed result, no INTERNAL_ERROR', async () => {
    const id = await child(); const op = operation(id, { base_version: 1 });
    const locker = new pg.Client({ connectionString: adminUrl }); await locker.connect();
    const requests = [];
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM children WHERE id=$1 FOR UPDATE', [id]);
      await locker.query('SELECT id FROM attendance_sessions WHERE child_id=$1 FOR UPDATE', [id]);
      for (let i = 0; i < 6; i++) requests.push(push(op));
      // Observe real lock waits rather than hoping a sleep creates a race.
      const deadline = Date.now() + 8000;
      let blocked = 0;
      while (Date.now() < deadline) {
        blocked = (await db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [applicationName])).rows[0].n;
        if (blocked >= 6) break;
        await delay(20);
      }
      assert.equal(blocked, 6, 'all six requests must overlap before release');
    } finally {
      await locker.query('ROLLBACK'); await locker.end();
      await Promise.allSettled(requests);
    }
    const results = await Promise.all(requests);
    results.forEach(r => assert.deepEqual(outcome(r), { accepted: [op.event_id], rejected: [], conflicts: [] }));
    assert.equal((await session(id)).version, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendance_events WHERE sync_event_id=$1', [op.event_id])).rows[0].n, 1);
  });
  await check('reusing an event ID for different content cannot acknowledge the changed request', async () => {
    const id = await child(); const op = operation(id); await push(op);
    const before = await effects(id);
    const r = await push({ ...op, payload: { ...op.payload, action: 'absent' } });
    assert.equal(r.rejected[0]?.reason, 'EVENT_ID_REUSED'); assert.deepEqual(r.accepted, []);
    assert.deepEqual(await effects(id), before);
  });
  await check('a second device cannot claim the first device event ID', async () => {
    const id = await child(); const op = operation(id); await push(op);
    const before = await effects(id);
    const r = await push(op, secondDevice);
    assert.equal(r.rejected[0]?.reason, 'EVENT_ID_OWNERSHIP_MISMATCH');
    assert.deepEqual(await effects(id), before);
  });
  await check('another user cannot claim a same-tenant event ID through their own device', async () => {
    const id = await child(); const op = operation(id); await push(op);
    const before = await effects(id); const ownerToken = token;
    try {
      const otherEmail = `f3-other-${suffix}@test.dz`;
      const other = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'Other','F3',$2,'active') RETURNING id", [otherEmail, await bcrypt.hash('Password123!', 4)])).rows[0].id;
      await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, other]);
      token = (await req('POST', '/auth/login', { email: otherEmail, password: 'Password123!' })).body.access_token;
      const r = await push(op, await register());
      assert.equal(r.rejected[0]?.reason, 'EVENT_ID_OWNERSHIP_MISMATCH');
      assert.deepEqual(await effects(id), before);
    } finally { token = ownerToken; }
  });
  await check('real deferred COMMIT failure never emits an accepted ACK and is retryable', async () => {
    const id = await child(); const op = operation(id); const before = await effects(id);
    const name = `f3_commit_${randomUUID().replaceAll('-', '')}`;
    let r;
    try {
      await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.event_id = '${op.event_id}'::uuid THEN RAISE EXCEPTION 'synthetic deferred commit failure'; END IF;
        RETURN NEW; END $$`);
      await db.query(`CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON sync_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      r = await push(op);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${name} ON sync_operations`);
      await db.query(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    assert.deepEqual(r.accepted, []); assert.deepEqual(r.conflicts, []);
    assert.equal(r.rejected.length, 1); assert.equal(r.rejected[0].reason, 'INTERNAL_ERROR');
    assert.deepEqual(await effects(id), before); await noRecordedOperation(op.event_id);
    assert.deepEqual((await push(op)).accepted, [op.event_id]);
  });
  await check('runtime error after a journal write rolls back every effect and permits retry', async () => {
    const id = await child(); const before = await effects(id);
    const op = operation(id, { command: 'log_note', entity_type: 'daily_log', payload: { child_id: id, note_text: 'Synthetic test note' } });
    const { JournalService } = await import('../../apps/api/dist/modules/journal/journal.service.js');
    const journal = app.get(JournalService); const original = journal.insertEvent;
    let r;
    try {
      journal.insertEvent = async function (...args) { await original.apply(this, args); throw new Error('synthetic failure after write'); };
      r = await push(op);
    } finally { journal.insertEvent = original; }
    assert.deepEqual(r.accepted, []); assert.equal(r.rejected[0]?.reason, 'INTERNAL_ERROR');
    assert.deepEqual(await effects(id), before); await noRecordedOperation(op.event_id);
    assert.deepEqual((await push(op)).accepted, [op.event_id]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM daily_log_events WHERE sync_event_id=$1', [op.event_id])).rows[0].n, 1);
  });
  await check('UUID casing in device/entity IDs remains idempotent for identical retries', async () => {
    const id = await child();
    const op = operation(id, { entity_id: id.toUpperCase() });
    const first = await push(op, device.toUpperCase());
    assert.deepEqual(first.accepted, [op.event_id]);
    const before = await effects(id);
    assert.deepEqual(outcome(await push(op, device.toUpperCase())), outcome(first));
    assert.deepEqual(await effects(id), before);
  });
  await check('two first-session corrections at base 0 create once and conflict once', async () => {
    const id = await child(false);
    const results = await Promise.all([push(operation(id, { base_version: 0 })), push(operation(id, { base_version: 0 }))]);
    assert.equal(results.flatMap(r => r.accepted).length, 1);
    assert.equal(results.flatMap(r => r.conflicts).length, 1);
    assert.equal(results.flatMap(r => r.rejected).length, 0);
    assert.equal((await session(id)).version, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendance_events WHERE child_id=$1', [id])).rows[0].n, 1);
  });
  await check('legacy accepted operation still replays its ACK without executing', async () => {
    const id = await child(); const op = operation(id);
    await db.query(`INSERT INTO sync_operations(organization_id,device_id,user_id,event_id,client_sequence,schema_version,command,entity_type,payload,occurred_at_device,status)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'accepted')`, [org, device, user, op.event_id, op.client_sequence, op.command, op.entity_type, JSON.stringify(op.payload), op.occurred_at_device]);
    const before = await effects(id);
    assert.deepEqual((await push(op)).accepted, [op.event_id]);
    assert.deepEqual(await effects(id), before);
  });
  await check('legacy conflict without a saved outcome fails explicitly without inventing a version', async () => {
    const id = await child(); const op = operation(id, { base_version: 0 });
    await db.query(`INSERT INTO sync_operations(organization_id,device_id,user_id,event_id,client_sequence,schema_version,command,entity_type,payload,base_version,occurred_at_device,status,rejection_reason)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,0,$9,'conflict','VERSION_MISMATCH')`, [org, device, user, op.event_id, op.client_sequence, op.command, op.entity_type, JSON.stringify(op.payload), op.occurred_at_device]);
    const before = await effects(id); const r = await push(op);
    assert.equal(r.rejected[0]?.reason, 'LEGACY_RESULT_UNAVAILABLE');
    assert.deepEqual(r.conflicts, []); assert.deepEqual(await effects(id), before);
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`F3 outcomes: ${passed}/${passed + failures} checks`);
if (failures) process.exitCode = 1;
