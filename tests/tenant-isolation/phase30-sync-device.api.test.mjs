#!/usr/bin/env node
/** F2 : registration retry and user/device scope. Without reset.
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
    const response = r.status === 204 ? {} : await r.json();
    if (r.status >= 400) assertSchema('ErrorResponse', response);
    else if (path.startsWith('/sync/pull')) assertSchema('PullResponse', response);
    else if (path === '/sync/push') assertSchema('PushResponse', response);
    else if (path === '/devices') assertSchema('RegisterResponse', response);
    return { status: r.status, body: response };
  }
  token = (await req('POST', '/auth/login', { email, password: 'Password123!' })).body.access_token;
  assert.ok(token);

  const ownerToken = token;
  const fingerprint = randomUUID();
  const register = fp => req('POST', '/devices', { name: 'F2 Device', device_fingerprint: fp, platform: 'android' });
  await check('concurrent registration retries return one device', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => register(fingerprint)));
    results.forEach(r => assert.equal(r.status, 201));
    assert.equal(new Set(results.map(r => r.body.device_id)).size, 1);
    const count = await db.query('SELECT count(*)::int AS n FROM devices WHERE organization_id=$1 AND registered_by=$2 AND device_fingerprint=$3', [org, user, fingerprint]);
    assert.equal(count.rows[0].n, 1);
  });
  const own = (await register(randomUUID())).body.device_id;
  const otherEmail = `f2-other-${suffix}@test.dz`;
  const other = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F2','Other',$2,'active') RETURNING id", [otherEmail, await bcrypt.hash('Password123!', 4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, other]);
  token = (await req('POST', '/auth/login', { email: otherEmail, password: 'Password123!' })).body.access_token;
  await check('same fingerprint in another user scope gets a different device', async () => {
    const r = await register(fingerprint); assert.equal(r.status, 201);
    const d = (await db.query('SELECT registered_by FROM devices WHERE id=$1', [r.body.device_id])).rows[0];
    assert.equal(d.registered_by, other);
  });
  await check('another user cannot pull with the owner device', async () => {
    assert.equal((await req('GET', `/sync/pull?cursor=0&device_id=${own}`)).status, 403);
  });
  await check('another user cannot push with the owner device', async () => {
    const r = await req('POST', '/sync/push', { device_id: own, operations: [{ event_id: randomUUID(), client_sequence: 1, schema_version: 1, command: 'check_in', entity_type: 'attendance', payload: { child_id: randomUUID() }, occurred_at_device: new Date().toISOString() }] });
    assert.equal(r.status, 200); assert.equal(r.body.rejected[0].reason, 'DEVICE_REVOKED');
  });
  await check('another user cannot revoke the owner device', async () => {
    assert.equal((await req('POST', `/devices/${own}/revoke`)).status, 404);
  });
  token = ownerToken;
  await check('registration never resurrects a revoked fingerprint', async () => {
    const fp = randomUUID(); const d = (await register(fp)).body.device_id;
    await db.query('UPDATE devices SET revoked_at=NOW(), is_active=false WHERE id=$1', [d]);
    const replay = await register(fp); assert.equal(replay.status, 403); assert.equal(replay.body.code, 'DEVICE_REVOKED');
  });
  await check('legacy duplicate fingerprints fail closed, never pick an arbitrary device', async () => {
    const fp = randomUUID(); await register(fp);
    await db.query("INSERT INTO devices(organization_id,registered_by,name,device_fingerprint,platform) VALUES($1,$2,'Legacy',$3,'android')", [org, user, fp]);
    const r = await register(fp); assert.equal(r.status, 409); assert.equal(r.body.code, 'DEVICE_REGISTRATION_AMBIGUOUS');
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`F2 devices : ${passed}/${passed + failures} assertions`);
if (failures) process.exitCode = 1;
