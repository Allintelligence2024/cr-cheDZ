#!/usr/bin/env node
// H2j: real HTTP/PG authorization and official Prometheus client parser.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { JwtService } from '@nestjs/jwt';
import { appUrl, ensureAppRole } from './helpers.mjs';
import { prometheusParser } from './prometheus-parser.mjs';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
await db.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } }
try {
  await ensureAppRole(db);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  const { MetricsService } = await import('../../apps/api/dist/modules/metrics/metrics.service.js');
  app = await createApp(); pool = app.get(PG_POOL); const metrics = app.get(MetricsService), jwt = app.get(JwtService);
  await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const request = async (path, token, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };
  const password = 'Synthetic-H2j-only!', hash = await bcrypt.hash(password, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2j','31') RETURNING id", [randomUUID()])).rows[0].id;
  async function actor(role = 'super_admin') {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'H2j','Synthetic',$2,'active',$3) RETURNING id", [email, hash, role === 'super_admin'])).rows[0].id;
    if (role !== 'super_admin') await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [org,id,role]);
    const r = await request('/auth/login', null, 'POST', { email, password }); assert.equal(r.status, 200);
    return { id, token: JSON.parse(r.text).access_token };
  }
  const admin = await actor(); const parse = await prometheusParser();
  await check('official parser accepts a valid exposition and rejects the historical invalid label syntax', async () => {
    assert.equal(parse('# TYPE example gauge\nexample{route="/health"} 1\n')[0].labels.route, '/health');
    assert.throws(() => parse('# TYPE example histogram\nexample_bucket{GET /health le=1} 1\n'));
  });
  const denied = async (token, status, method = 'GET') => {
    const r = await request('/metrics', token, method); assert.equal(r.status, status);
    assert.equal(r.text.includes('creche_'), false); assert.equal(r.text.includes('http_requests_total'), false);
  };
  await check('anonymous GET cannot read global metrics', () => denied(null,401));
  await check('anonymous HEAD is protected too', () => denied(null,401,'HEAD'));
  await check('invalid bearer cannot read metrics', () => denied('invalid',401));
  for (const role of ['director','accountant','educator','parent']) await check(`${role}: tenant role cannot read platform totals`, async () => { await denied((await actor(role)).token,403); });
  await check('expired access token is refused', () => denied(jwt.sign({ purpose:'access', sub:admin.id, role:'super_admin', isSuperAdmin:true }, { expiresIn:-1 }),401));
  await check('non-access token purpose is refused', () => denied(jwt.sign({ purpose:'invitation', sub:admin.id, role:'super_admin', isSuperAdmin:true }),401));
  for (const [name, sql] of [
    ['privilege removed', 'UPDATE users SET is_super_admin=false WHERE id=$1'],
    ['suspended', "UPDATE users SET status='suspended' WHERE id=$1"],
    ['pending', "UPDATE users SET status='pending' WHERE id=$1"],
    ['deleted', 'UPDATE users SET deleted_at=NOW() WHERE id=$1'],
    ['locked', "UPDATE users SET locked_until=NOW()+INTERVAL '10 minutes' WHERE id=$1"],
  ]) await check(`stale administrator JWT: ${name} is refused`, async () => { const u = await actor(); await db.query(sql,[u.id]); await denied(u.token,403); });
  await check('active platform administrator keeps access to global gauges', async () => {
    const r = await request('/metrics',admin.token); assert.equal(r.status,200); assert.match(r.headers.get('content-type'),/text\/plain;.*version=0.0.4/); assert.match(r.text,/creche_jobs_pending \d+/);
  });
  await check('authorized response is explicitly non-cacheable', async () => { assert.equal((await request('/metrics',admin.token)).headers.get('cache-control'),'no-store'); });
  await check('live HTTP exposition parses after multiple requests', async () => {
    await request('/health'); const samples = parse((await request('/metrics',admin.token)).text);
    assert.ok(samples.some(s => s.name === 'http_requests_total' && s.labels.route === '/api/v1/health'));
  });
  await check('unmatched paths never become metric labels or leak synthetic private path text', async () => {
    const canary = 'private-' + randomUUID();
    for (let i=0;i<20;i++) await request(`/${canary}-${i}`);
    const r = await request('/metrics',admin.token); assert.equal(r.text.includes(canary),false);
    const samples = parse(r.text).filter(s => s.name === 'http_requests_total' && s.labels.route === 'unmatched');
    assert.equal(samples.length,1); assert.ok(Number(samples[0].value)>=20);
  });
  await check('matched dynamic URLs expose the route template, never object IDs', async () => {
    const id = randomUUID(); await request(`/children/${id}`);
    const r = await request('/metrics',admin.token); assert.equal(r.text.includes(id),false);
    assert.ok(r.text.includes('route="/api/v1/children/:id"'));
  });
  await check('unknown HTTP methods are bounded to OTHER', async () => {
    await request('/health',null,'PROPFIND');
    assert.ok((await request('/metrics',admin.token)).text.includes('method="OTHER"'));
  });
  await check('label escaping preserves spaces, quotes, backslashes and newlines', async () => {
    const method = 'CUSTOM', route = '/synthetic space/"quote"/\\line\nnext'; metrics.httpRequest(method,route,200,0.1);
    const samples = parse((await request('/metrics',admin.token)).text);
    assert.ok(samples.some(s => s.name === 'http_requests_total' && s.labels.method === method && s.labels.route === route));
  });
  await check('histogram includes zero buckets in numeric order, cumulative counts, +Inf, sum and count', async () => {
    const route = '/synthetic-histogram', durations = [0.001,0.03,0.06,0.2,0.4,0.9,2,4,9,11];
    for (const duration of durations) metrics.httpRequest('GET',route,200,duration);
    metrics.httpRequest('GET','/zero-buckets',200,11);
    const text = (await request('/metrics',admin.token)).text;
    assert.equal((text.match(/http_request_duration_seconds_bucket.*\/zero-buckets/g) ?? []).length,10);
    const samples = parse(text);
    const bucket = samples.filter(s => s.name === 'http_request_duration_seconds_bucket' && s.labels.route === route);
    assert.deepEqual(bucket.map(s=>s.labels.le), ['0.01','0.05','0.1','0.25','0.5','1','2.5','5','10','+Inf']);
    assert.deepEqual(bucket.map(s=>Number(s.value)),[1,2,3,4,5,6,7,8,9,10]);
    assert.equal(Number(samples.find(s=>s.name==='http_request_duration_seconds_count' && s.labels.route===route).value),10);
    assert.ok(Math.abs(Number(samples.find(s=>s.name==='http_request_duration_seconds_sum' && s.labels.route===route).value)-durations.reduce((a,b)=>a+b,0))<0.000001);
    assert.deepEqual(samples.filter(s=>s.name==='http_request_duration_seconds_bucket' && s.labels.route==='/zero-buckets').map(s=>Number(s.value)),[0,0,0,0,0,0,0,0,0,1]);
  });
  await check('global SQL gauges remain accurate under creche_app (not false tenant zeros)', async () => {
    const otherOrg=(await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2j B','31') RETURNING id",[randomUUID()])).rows[0].id;
    await db.query("INSERT INTO background_jobs(organization_id,job_type,payload) VALUES($1,'retention_purge','{}'),($2,'retention_purge','{}')",[org,otherOrg]);
    const count=Number((await db.query("SELECT count(*) n FROM background_jobs WHERE status='pending'")).rows[0].n);
    assert.ok(count>=2);
    const expected=(await db.query('SELECT metric,n FROM metrics_global_counts()')).rows;
    const text=(await request('/metrics',admin.token)).text;
    for(const r of expected) assert.ok(text.includes(`creche_${r.metric} ${r.n}\n`));
    assert.ok(text.includes(`creche_jobs_pending ${count}\n`));
  });
  await check('unavailable database gauges remain NaN rather than falsely healthy zeros', async () => {
    await db.query('ALTER FUNCTION metrics_global_counts() RENAME TO h2j_metrics_unavailable');
    try { const r=await request('/metrics',admin.token); assert.equal(r.status,200); assert.match(r.text,/creche_jobs_pending NaN/); }
    finally { await db.query('ALTER FUNCTION h2j_metrics_unavailable() RENAME TO metrics_global_counts'); }
  });
  await check('health endpoint remains public', async () => { assert.equal((await request('/health')).status,200); });
} finally { if(app) await app.close(); if(pool) await pool.end(); await db.end(); }
console.log(`H2j metrics: ${passed} passed, ${failed} failed`);
if(failed) process.exitCode=1;
