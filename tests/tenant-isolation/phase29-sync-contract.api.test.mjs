#!/usr/bin/env node
/** F1/F3 : vraie API + PostgreSQL, curseurs int64 opaques. Sans reset.
 * F4 NON couvert : pas de moteur Flutter/Drift ni d'événements child.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';
import { assertSchema } from '../contracts/schema-validator.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let app, pool, org;
let failures = 0, passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}: ${error.message}`); }
}
try {
  await ensureAppRole(db);
  const suffix = randomUUID();
  org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'F1 Test','31') RETURNING id", [`f1-${suffix}`])).rows[0].id;
  const email = `f1-${suffix}@test.dz`;
  const user = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F1','Test',$2,'active') RETURNING id", [email, await bcrypt.hash('Password123!', 4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, user]);
  process.env.DATABASE_URL = appUrl();
  process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  async function req(method, path, body) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await r.json();
    if (r.status >= 400) assertSchema('ErrorResponse', response);
    else if (path.startsWith('/sync/pull')) assertSchema('PullResponse', response);
    else if (path === '/sync/push') assertSchema('PushResponse', response);
    else if (path === '/devices') assertSchema('RegisterResponse', response);
    return { status: r.status, body: response };
  }
  token = (await req('POST', '/auth/login', { email, password: 'Password123!' })).body.access_token;
  assert.ok(token);
  const device = (await req('POST', '/devices', { name: 'F1 appareil', device_fingerprint: randomUUID(), platform: 'android' })).body.device_id;
  assert.ok(device);
  const pull = (cursor, deviceId = device) => req('GET', `/sync/pull?cursor=${encodeURIComponent(cursor)}&device_id=${deviceId}`);
  await check('sans device : push/pull restent 400', async () => {
    assert.equal((await req('POST', '/sync/push', { operations: [] })).status, 400);
    assert.equal((await req('GET', '/sync/pull?cursor=0')).status, 400);
  });
  await check('pull vide initial : curseur chaîne "0"', async () => {
    const r = await pull('0'); assert.equal(r.status, 200); assert.deepEqual(r.body, { events: [], next_cursor: '0' });
  });
  await check('push vide : curseur chaîne "0"', async () => {
    const r = await req('POST', '/sync/push', { device_id: device, operations: [] });
    assert.equal(r.status, 200); assert.equal(r.body.next_cursor, '0');
  });
  for (const cursor of ['-1', '00', '01', '+1', '1.0', '1e3', ' 1', '1\n', '', 'NaN', '9223372036854775808', '999999999999999999999999999999999999']) {
    await check(`curseur non canonique/hors int64 ${JSON.stringify(cursor)} : 400`, async () => assert.equal((await pull(cursor)).status, 400));
  }
  await check('device inconnu : 403, pas un curseur valide pour contourner la garde', async () => assert.equal((await pull('0', randomUUID())).status, 403));
  // Preserve F0's positive API coverage when retiring its old number assertions.
  await check('push métier → second appareil → rejeu sans doublon (API, pas Dart)', async () => {
    const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F1 Site') RETURNING id", [org])).rows[0].id;
    const child = await req('POST', '/children', { site_id: site, first_name_fr: 'F1', last_name_fr: 'Test', date_of_birth: '2024-01-01', status: 'active' });
    assert.equal(child.status, 201);
    const second = (await req('POST', '/devices', { name: 'F1 second', device_fingerprint: randomUUID(), platform: 'android' })).body.device_id;
    const op = { event_id: randomUUID(), client_sequence: 1, schema_version: 1, command: 'check_in', entity_type: 'attendance',
      payload: { child_id: child.body.id, site_id: site }, occurred_at_device: new Date().toISOString() };
    const sent = await req('POST', '/sync/push', { device_id: device, operations: [op] });
    assert.equal(sent.status, 200); assert.deepEqual(sent.body.accepted, [op.event_id]);
    const received = await pull('0', second); assert.equal(received.status, 200); assert.ok(received.body.events.length);
    const retry = await req('POST', '/sync/push', { device_id: device, operations: [op] });
    assert.deepEqual(retry.body.accepted, [op.event_id]);
    const replay = await pull(received.body.next_cursor, second);
    assert.deepEqual(replay.body, { events: [], next_cursor: received.body.next_cursor });
    const rejected = await req('POST', '/sync/push', { device_id: device, operations: [{ ...op, event_id: randomUUID(), command: 'unknown_command' }] });
    assert.equal(rejected.body.rejected[0].reason, 'UNKNOWN_COMMAND');
  });
  await check('ORDER BY numérique malgré la projection texte (9 → 10 chiffres)', async () => {
    for (const seq of ['800000000', '1000000000']) {
      await db.query(`INSERT INTO sync_changelog(sync_seq,organization_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES($1,$2,'contract_probe',$3,'probe','{}')`, [seq, org, randomUUID()]);
    }
    const page = await pull('799999999');
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.events.map(e => e.sync_seq), ['800000000', '1000000000']);
    assert.equal(page.body.next_cursor, '1000000000');
    assert.deepEqual((await pull(page.body.next_cursor)).body, { events: [], next_cursor: '1000000000' });
  });
  for (const seq of ['2147483648', '9007199254740993', '9223372036854775807']) {
    await db.query(`INSERT INTO sync_changelog(sync_seq,organization_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES($1,$2,'contract_probe',$3,'probe','{}')`, [seq, org, randomUUID()]);
    await check(`push MAX ${seq} : pas de cast int32 ni de Number`, async () => {
      const r = await req('POST', '/sync/push', { device_id: device, operations: [] });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.next_cursor, seq);
    });
    await check(`pull/reprise exacte ${seq} : aucun doublon ni arrondi`, async () => {
      const before = (BigInt(seq) - 1n).toString();
      const first = await pull(before); assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.events.length, 1); assert.equal(first.body.events[0].sync_seq, seq); assert.equal(first.body.next_cursor, seq);
      const replay = await pull(seq); assert.equal(replay.status, 200, JSON.stringify(replay.body));
      assert.deepEqual(replay.body, { events: [], next_cursor: seq });
    });
  }
  await check('cursor persisté sans perte en PostgreSQL', async () => {
    const r = await db.query('SELECT cursor_value::text FROM sync_cursors WHERE device_id=$1 AND organization_id=$2', [device, org]);
    assert.equal(r.rows[0].cursor_value, '9223372036854775807');
  });
  await check('révocation : 403 même avec le dernier curseur', async () => {
    await db.query('UPDATE devices SET revoked_at=NOW() WHERE id=$1', [device]);
    assert.equal((await pull('9223372036854775807')).status, 403);
  });
} finally {
  if (app) await app.close();
  if (pool) await pool.end();
  // Les valeurs extrêmes de ces fixtures ne doivent pas occuper les IDs globaux.
  if (org) await db.query('DELETE FROM sync_changelog WHERE organization_id=$1', [org]);
  await db.end();
}
console.log(`F1/F3 : ${passed}/${passed + failures} assertions ; F4 non revendiqué.`);
if (failures) process.exitCode = 1;
