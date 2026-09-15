#!/usr/bin/env node
// G1c/H2: real HTTP/PG. Development token handoff only; no mail provider is mocked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const observer = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect(); await observer.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } }
try {
  await ensureAppRole(db);
  const password = 'Synthetic-G1c-only!', hash = await bcrypt.hash(password, 4);
  const org = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G1c','31') RETURNING id", [randomUUID()])).rows[0].id;
  const a = await org(), b = await org();
  const actor = async (role = 'director', tenant = a, platform = false) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'G1c','Actor',$2,'active',$3) RETURNING id", [email, hash, platform])).rows[0].id;
    if (role) await db.query('INSERT INTO memberships(organization_id,user_id,role_id,joined_at) SELECT $1,$2,id,NOW() FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor(), foreign = await actor('director', b), educator = await actor('educator'), admin = await actor(null, a, true);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'development', EMAIL_PROVIDER: 'none', BCRYPT_ROUNDS: '4', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  const { ConfigService } = await import('@nestjs/config');
  async function start(mode) {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
    assert.equal(app.get(ConfigService).get('NODE_ENV'), mode);
  }
  async function stop() { await app.close(); await pool.end(); app = pool = undefined; }
  await start('development');
  const req = async (path, body, user, method = 'POST') => {
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json() };
  };
  const login = async u => { const r = await req('/auth/login', { email: u.email, password }); assert.equal(r.status, 200); u.token = r.body.access_token; };
  for (const u of [director, foreign, educator, admin]) await login(u);
  const invite = (u = director, tenant, email = `${randomUUID()}@test.invalid`, role = 'educator') => req('/invitations', { email, role_slug: role, ...(tenant ? { organization_id: tenant } : {}) }, u);
  const fixture = async () => {
    const email = `${randomUUID()}@test.invalid`, r = await invite(director, undefined, email);
    assert.equal(r.status, 201); assert.ok(r.body.invitation_token);
    const id = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    return { id, email, token: r.body.invitation_token, membership: r.body.invitation_id };
  };
  const accept = (f, first = 'Accepted') => req('/auth/accept-invitation', { invitation_token: f.token, first_name: first, last_name: 'Synthetic', password });
  const snap = async () => ({
    users: (await db.query("SELECT * FROM users WHERE email LIKE '%@test.invalid' ORDER BY id")).rows,
    memberships: (await db.query('SELECT * FROM memberships WHERE organization_id=ANY($1::uuid[]) ORDER BY id', [[a, b]])).rows,
    sessions: (await db.query("SELECT s.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email LIKE '%@test.invalid' ORDER BY s.id")).rows,
    audit: (await db.query("SELECT * FROM audit_logs WHERE resource_type='membership' AND organization_id=ANY($1::uuid[]) ORDER BY id", [[a, b]])).rows,
  });
  const noWrite = async (operation, status, code) => {
    const before = await snap(), r = await operation();
    assert.equal(r.status, status, JSON.stringify({ status: r.status, code: r.body.code }));
    if (code) assert.equal(r.body.code, code);
    assert.equal(r.body.access_token, undefined); assert.equal(r.body.refresh_token, undefined); assert.equal(r.body.invitation_token, undefined);
    assert.deepEqual(await snap(), before);
  };
  await check('development handoff: normal invite and atomic acceptance with audit', async () => {
    const f = await fixture(), r = await accept(f); assert.equal(r.status, 200);
    assert.equal(r.body.user.organization_id, a); assert.equal(r.body.user.role, 'educator'); assert.equal(r.body.user.first_name, 'Accepted');
    const u = (await db.query('SELECT * FROM users WHERE id=$1', [f.id])).rows[0]; assert.equal(u.status, 'active'); assert.ok(await bcrypt.compare(password, u.password_hash));
    const m = (await db.query('SELECT * FROM memberships WHERE id=$1', [f.membership])).rows[0]; assert.ok(m.joined_at);
    const audit = (await db.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_label='invitation_accept'", [f.id])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].organization_id, a); assert.equal(audit[0].resource_id, f.membership);
    assert.deepEqual(audit[0].new_values, { role: 'educator' });
  });
  await check('same invitation concurrent: one profile, membership activation, session and audit', async () => {
    const f = await fixture(), pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await db.query('BEGIN'); await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.id]);
    const work = Promise.all([accept(f, 'First'), accept(f, 'Second')]); let blocked = false;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const r = await observer.query(`WITH RECURSIVE waiters(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION SELECT s.pid FROM pg_stat_activity s JOIN waiters w ON w.pid=ANY(pg_blocking_pids(s.pid))
        ) SELECT count(DISTINCT pid)::int AS n FROM waiters`, [pid]);
        if (r.rows[0].n >= 2) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await db.query('COMMIT'); }
    const replies = await work; assert.ok(blocked); assert.deepEqual(replies.map(r => r.status).sort(), [200, 400]);
    assert.equal(replies.find(r => r.status === 400).body.code, 'INVITATION_ALREADY_USED');
    const u = (await db.query('SELECT first_name FROM users WHERE id=$1', [f.id])).rows[0]; assert.equal(u.first_name, replies.find(r => r.status === 200).body.user.first_name);
    assert.equal((await db.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [f.id])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE user_id=$1 AND resource_label='invitation_accept'", [f.id])).rows[0].n, 1);
  });
  const used = await fixture(); assert.equal((await accept(used)).status, 200);
  await check('sequential reuse remains rejected without mutation', () => noWrite(() => accept(used), 400, 'INVITATION_ALREADY_USED'));
  for (const [name, sql, status, code] of [
    ['suspended', "UPDATE users SET status='suspended' WHERE id=$1", 400, 'INVALID_INVITATION'],
    ['deleted', 'UPDATE users SET deleted_at=NOW() WHERE id=$1', 400, 'INVALID_INVITATION'],
    ['locked', "UPDATE users SET locked_until=NOW()+INTERVAL '10 minutes' WHERE id=$1", 423, 'ACCOUNT_LOCKED'],
    ['revoked membership', 'UPDATE memberships SET is_active=false WHERE user_id=$1', 400, 'INVALID_INVITATION'],
    ['missing membership', 'DELETE FROM memberships WHERE user_id=$1', 400, 'INVALID_INVITATION'],
    ['already joined pending account', 'UPDATE memberships SET joined_at=NOW() WHERE user_id=$1', 400, 'INVALID_INVITATION'],
    ['role changed since invitation', "UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='accountant') WHERE user_id=$1", 400, 'INVALID_INVITATION'],
    ['email changed since invitation', "UPDATE users SET email=id::text||'-changed@test.invalid' WHERE id=$1", 400, 'INVALID_INVITATION'],
  ]) await check(`${name}: acceptance denied before mutation`, async () => {
    const f = await fixture(); await db.query(sql, [f.id]); await noWrite(() => accept(f), status, code);
  });
  await check('inactive invited organization rejected', async () => {
    const f = await fixture(); await db.query('UPDATE organizations SET is_active=false WHERE id=$1', [a]);
    try { await noWrite(() => accept(f), 400, 'INVALID_INVITATION'); } finally { await db.query('UPDATE organizations SET is_active=true WHERE id=$1', [a]); }
  });
  await check('acceptance issues target organization, not an older membership', async () => {
    const f = await fixture(); await db.query("INSERT INTO memberships(organization_id,user_id,role_id,joined_at) SELECT $1,$2,id,NOW()-INTERVAL '1 day' FROM roles WHERE slug='parent_primary'", [b, f.id]);
    const r = await accept(f); assert.equal(r.status, 200); assert.equal(r.body.user.organization_id, a); assert.equal(r.body.user.role, 'educator');
  });
  await check('invitation cannot be used as access token', async () => {
    const f = await fixture(); assert.equal((await req('/auth/2fa/enable', {}, { token: f.token })).status, 401);
  });
  await check('access token cannot activate an invitation', () => noWrite(() => accept({ token: director.token }), 400, 'INVALID_INVITATION'));
  const { INVITATION_JWT_SERVICE } = await import('../../apps/api/dist/shared/auth/invitation-jwt.module.js');
  const signer = app.get(INVITATION_JWT_SERVICE);
  await check('invitation expiring while blocked is rejected before activation', async () => {
    const f = await fixture();
    f.token = await signer.signAsync({ purpose: 'invitation', sub: f.id, orgId: a, role: 'educator', email: f.email }, { expiresIn: 3 });
    const expires = JSON.parse(Buffer.from(f.token.split('.')[1], 'base64url')).exp;
    const before = await snap(), pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await db.query('BEGIN'); await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.id]);
    const work = accept(f); let blocked = false;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if ((await observer.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expires * 1000 + 100 - Date.now())));
    } finally { await db.query('COMMIT'); }
    const r = await work; assert.ok(blocked); assert.equal(r.status, 400); assert.equal(r.body.code, 'INVALID_INVITATION'); assert.deepEqual(await snap(), before);
  });
  for (const [name, patch, opts] of [['expired', {}, { expiresIn: -1 }], ['invalid UUID claim', { sub: 'invalid-uuid' }, {}]]) await check(`${name}: invalid signed invitation denied`, async () => {
    const f = await fixture(); f.token = await signer.signAsync({ purpose: 'invitation', sub: f.id, orgId: a, role: 'educator', email: f.email, ...patch }, opts);
    await noWrite(() => accept(f), 400, 'INVALID_INVITATION');
  });
  for (const table of ['sessions', 'audit_logs']) {
    const f = await fixture();
    await db.query(`CREATE FUNCTION g1c_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${f.id}'::uuid THEN RAISE EXCEPTION 'G1c synthetic storage failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER g1c_test_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION g1c_test_failure()`);
    try { await check(`${table} failure rolls back profile, membership, session and audit`, () => noWrite(() => accept(f), 500)); }
    finally { await db.query(`DROP TRIGGER g1c_test_failure ON ${table}; DROP FUNCTION g1c_test_failure()`); }
    await check(`${table} restored: same invitation remains usable`, async () => { assert.equal((await accept(f)).status, 200); });
  }
  await check('director cannot invite into another tenant via body override', () => noWrite(() => invite(director, b), 403, 'FORBIDDEN'));
  await check('director retains own-tenant invitation with uppercase UUID representation', async () => {
    const r = await invite(director, a.toUpperCase()); assert.equal(r.status, 201);
    const m = (await db.query('SELECT organization_id FROM memberships WHERE id=$1', [r.body.invitation_id])).rows[0]; assert.equal(m.organization_id, a);
  });
  await check('other director can invite into own tenant', async () => { assert.equal((await invite(foreign, b)).status, 201); });
  await check('platform administrator retains cross-tenant invitation', async () => { assert.equal((await invite(admin, b)).status, 201); });
  await check('educator cannot invite', () => noWrite(() => invite(educator), 403));
  await check('super_admin role remains unassignable', () => noWrite(() => invite(director, a, undefined, 'super_admin'), 403, 'ROLE_FORBIDDEN'));
  for (const [name, sql, restore] of [
    ['suspended creator', "UPDATE users SET status='suspended' WHERE id=$1", "UPDATE users SET status='active' WHERE id=$1"],
    ['revoked creator membership', 'UPDATE memberships SET is_active=false WHERE user_id=$1', 'UPDATE memberships SET is_active=true WHERE user_id=$1'],
    ['downgraded creator role', "UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='educator') WHERE user_id=$1", "UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='director') WHERE user_id=$1"],
  ]) {
    await db.query(sql, [director.id]);
    try { await check(`${name}: old JWT cannot create invitations`, () => noWrite(() => invite(director), 403, 'FORBIDDEN')); }
    finally { await db.query(restore, [director.id]); }
  }
  await db.query('UPDATE users SET is_super_admin=false WHERE id=$1', [admin.id]);
  try { await check('removed platform privilege: old JWT cannot target another tenant', () => noWrite(() => invite(admin, b), 403, 'FORBIDDEN')); }
  finally { await db.query('UPDATE users SET is_super_admin=true WHERE id=$1', [admin.id]); }
  const multi = await actor('educator');
  await db.query("INSERT INTO role_assignments(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [a, multi.id]); await login(multi);
  await check('additional director role remains valid for invitations', async () => { assert.equal((await invite(multi)).status, 201); });
  await stop();
  for (const mode of ['test', 'staging', 'production', undefined]) {
    await start(mode); await login(director);
    await check(`${mode ?? 'unset'}: no token or false delivery, unavailable transport leaves no writes`, () => noWrite(() => invite(director), 503, 'INVITATION_DELIVERY_UNAVAILABLE'));
    await stop();
  }
  process.env.EMAIL_PROVIDER = 'smtp'; await start('development'); await login(director);
  await check('unsupported development provider fails before domain writes', () => noWrite(() => invite(director), 503, 'INVITATION_DELIVERY_UNAVAILABLE'));
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await observer.end(); await db.end();
}
console.log(`G1c invitations: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
