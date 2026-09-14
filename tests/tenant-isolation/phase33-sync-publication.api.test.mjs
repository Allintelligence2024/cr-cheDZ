#!/usr/bin/env node
// F3c: deterministic A-slow/B-fast race on real PG, observed through real HTTP.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';
import { assertSchema } from '../contracts/schema-validator.mjs';
const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'));
const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
let app, pool, passed = 0, failed = 0;
const connections = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
try {
  await ensureAppRole(admin);
  const applicationUrl = appUrl();
  const tag = randomUUID(); const email = `f3c-${tag}@test.dz`;
  const user = (await admin.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F3c','Synthetic',$2,'active') RETURNING id", [email, await bcrypt.hash('Password123!', 4)])).rows[0].id;
  const makeOrg = async () => (await admin.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'F3c','31') RETURNING id", [`f3c-${randomUUID()}`])).rows[0].id;
  const org = await makeOrg(), otherOrg = await makeOrg();
  await admin.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [org, user]);
  process.env.DATABASE_URL = applicationUrl; process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  async function req(method, path, body) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await r.json(); assert.ok(r.ok, JSON.stringify(result));
    if (path.startsWith('/sync/pull')) assertSchema('PullResponse', result);
    return result;
  }
  token = (await req('POST', '/auth/login', { email, password: 'Password123!' })).access_token;
  const device = (await req('POST', '/devices', { name: 'F3c', device_fingerprint: tag, platform: 'android' })).device_id;
  const pull = cursor => req('GET', `/sync/pull?cursor=${cursor}&device_id=${device}`);
  async function connection(tenant = org) {
    const c = new pg.Client({ connectionString: applicationUrl }); await c.connect(); connections.push(c);
    await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await c.query("SET LOCAL statement_timeout='8s'"); return c;
  }
  async function insert(c, tenant = org, count = 1) {
    return (await c.query("INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload) SELECT $1,'publication_probe',uuid_generate_v4(),'probe','{}' FROM generate_series(1,$2) RETURNING sync_seq::text,aggregate_id", [tenant, count])).rows;
  }
  const watermark = async () => (await admin.query('SELECT COALESCE(MAX(sync_seq),0)::text AS n FROM sync_changelog WHERE organization_id=$1', [org])).rows[0].n;
  async function race(count, rollback = false) {
    const cursor = await watermark(); const a = await connection(), b = await connection();
    const aRow = (await insert(a))[0]; const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let done = false, bRows, bError;
    const work = (async () => { try { bRows = await insert(b, org, count); await b.query('COMMIT'); } catch (e) { bError = e; } finally { done = true; } })();
    let early;
    try {
      // Wait for a real lock wait OR B's commit. No scheduling assumption/sleep race.
      const deadline = Date.now() + 4000; let observed = false;
      while (Date.now() < deadline) {
        if (done || (await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [pid])).rowCount) { observed = true; break; }
        await delay(10);
      }
      assert.ok(observed, 'B neither completed nor entered a lock wait');
      early = await pull(cursor);
    } finally { await a.query(rollback ? 'ROLLBACK' : 'COMMIT'); await work; }
    if (bError) throw bError;
    const received = [...early.events]; let next = early.next_cursor;
    for (let n = 0; n < 5; n++) { const page = await pull(next); received.push(...page.events); next = page.next_cursor; if (!page.events.length) break; }
    const wanted = [...(rollback ? [] : [aRow]), ...bRows].map(r => r.aggregate_id);
    assert.deepEqual(new Set(received.map(e => e.aggregate_id)), new Set(wanted), 'A was permanently skipped after reading B');
    assert.equal(received.length, wanted.length, 'duplicate publication');
    assert.deepEqual(await pull(next), { events: [], next_cursor: next });
  }
  await check('A slow/B fast: no late event is skipped after cursor advancement', () => race(1));
  await check('A slow/B fast across 500-event pages: every event arrives once', () => race(501));
  await check('rollback of A releases B and leaves a harmless sequence gap', () => race(1, true));
  await check('another tenant publishes without waiting for tenant A', async () => {
    const a = await connection(), b = await connection(otherOrg);
    try { await insert(a); await b.query("SET LOCAL statement_timeout='1s'"); assert.equal((await insert(b, otherOrg)).length, 1); await b.query('COMMIT'); }
    finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); }
  });
  await check('application cannot supply its own sequence and bypass publication order', async () => {
    const c = await connection();
    try { await assert.rejects(c.query("INSERT INTO sync_changelog(sync_seq,organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES(800000001,$1,'probe',$2,'probe','{}')", [org, randomUUID()]), e => e.code === '42501'); }
    finally { await c.query('ROLLBACK'); }
  });
  for (const action of ['UPDATE sync_changelog SET sync_seq=sync_seq+800000010', "UPDATE sync_changelog SET payload='{}'", 'DELETE FROM sync_changelog']) {
    await check(`published application log is append-only: ${action}`, async () => {
      const c = await connection(); const id = (await insert(c))[0].aggregate_id; await c.query('COMMIT');
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [org]);
      try { await assert.rejects(c.query(`${action} WHERE aggregate_id=$1`, [id]), e => e.code === '42501'); }
      finally { await c.query('ROLLBACK'); }
    });
  }
} finally {
  for (const c of connections) { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  if (app) await app.close(); if (pool) await pool.end(); await admin.end();
}
console.log(`F3c publication: ${passed}/${passed + failed} checks`);
if (failed) process.exitCode = 1;
