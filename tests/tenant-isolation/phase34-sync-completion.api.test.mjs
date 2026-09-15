#!/usr/bin/env node
// F closure: real HTTP journal dates and direct SQL reference integrity.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

  const otherUser = (await admin.query("INSERT INTO users(email,first_name,last_name,status) VALUES($1,'Other','Synthetic','active') RETURNING id", [`other-${tag}@test.dz`])).rows[0].id;
  const peer = (await admin.query("INSERT INTO users(email,first_name,last_name,status) VALUES($1,'Peer','Synthetic','active') RETURNING id", [`peer-${tag}@test.dz`])).rows[0].id;
  for (const [o,u] of [[otherOrg,otherUser],[org,peer]]) await admin.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [o,u]);
  const otherDevice = (await admin.query("INSERT INTO devices(organization_id,name,device_fingerprint,platform,registered_by) VALUES($1,'Other',$2,'android',$3) RETURNING id", [otherOrg,randomUUID(),otherUser])).rows[0].id;
  const c = new pg.Client({connectionString: applicationUrl}); await c.connect(); connections.push(c);
  async function transaction(fn) {
    await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [org]);
    try { return await fn(); } finally { await c.query('ROLLBACK'); }
  }
  const operation = (d=device,u=user) => c.query(`INSERT INTO sync_operations(organization_id,device_id,user_id,event_id,client_sequence,command,entity_type,payload,occurred_at_device)
    VALUES($1,$2,$3,$4,1,'log_note','daily_log','{}',NOW()) RETURNING id`, [org,d,u,randomUUID()]);
  async function rejected(fn) {
    // Roll back even a wrongly accepted write: red fixtures never poison migrations.
    let error; await transaction(async()=> { try { await fn(); } catch(e) { error=e; } });
    assert.equal(error?.code,'23503','expected composite foreign-key rejection');
  }
  await check('SQL rejects operation referencing another tenant device', ()=>rejected(()=>operation(otherDevice)));
  await check('SQL rejects operation with the wrong owner in the same tenant', ()=>rejected(()=>operation(device,peer)));
  await check('SQL rejects cursor referencing another tenant device', ()=>rejected(()=>c.query('INSERT INTO sync_cursors(organization_id,device_id) VALUES($1,$2)',[org,otherDevice])));
  for (const origin of [otherDevice,randomUUID()]) await check('SQL rejects foreign or nonexistent changelog origin', ()=>rejected(()=>c.query("INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload,origin_device_id) VALUES($1,'media',$2,'media_registered','{}',$3)",[org,randomUUID(),origin])));
  await check('SQL rejects registering a device to a foreign tenant member', ()=>rejected(()=>c.query("INSERT INTO devices(organization_id,name,device_fingerprint,platform,registered_by) VALUES($1,'Invalid',$2,'android',$3)",[org,randomUUID(),otherUser])));
  await check('SQL rejects changing device owner underneath accepted history', ()=>rejected(async()=> {
    const op = await operation();
    await c.query("UPDATE sync_operations SET status='accepted',response_outcome='{\"status\":\"accepted\"}' WHERE id=$1",[op.rows[0].id]);
    await c.query('UPDATE devices SET registered_by=$1 WHERE id=$2',[peer,device]);
  }));
  await check('SQL valid references and device-free server publications remain legal', ()=>transaction(async()=> {
    await operation(); await c.query('INSERT INTO sync_cursors(organization_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[org,device]);
    await c.query("INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'media',$2,'media_registered','{}')",[org,randomUUID()]);
  }));
  const site = (await admin.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F close') RETURNING id",[org])).rows[0].id;
  const child = await req('POST','/children',{site_id:site,first_name_fr:'F close',last_name_fr:'Synthetic',date_of_birth:'2024-02-29'});
  const today = (await admin.query("SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date::text AS d")).rows[0].d;
  await check('HTTP journal returns a calendar DATE, not a UTC timestamp', async()=> {
    const event = await req('POST','/journal/events',{child_id:child.id,event_type:'meal',meal_quantity:'all'});
    assert.equal(event.event_date,today);
  });
  await check('journal pull carries a calendar DATE and the canonical event identity', async()=> {
    const events=(await pull('0')).events.filter(e=>e.type==='daily_log'); assert.equal(events.length,1);
    assert.equal(events[0].payload.event_date,today); assert.equal(events[0].payload.child_id,child.id);
    assert.equal(events[0].event_type,'meal');
  });
} finally {
  for (const c of connections) await c.end();
  if (app) await app.close(); if (pool) await pool.end(); await admin.end();
}
console.log(`F completion: ${passed} passed, ${failed} failed`); process.exitCode=failed?1:0;
