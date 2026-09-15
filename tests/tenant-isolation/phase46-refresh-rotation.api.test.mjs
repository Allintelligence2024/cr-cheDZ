#!/usr/bin/env node
// G1b: opaque refresh rotation over real HTTP/PG, including deterministic overlap.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

const url = process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: url }), observer = new pg.Client({ connectionString: url });
await db.connect(); await observer.connect();
let app, pool, passed = 0, failed = 0;
const hashToken = token => createHash('sha256').update(token).digest('hex');
async function check(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } }
try {
  await ensureAppRole(db);
  const password = 'Synthetic-G1b-only!', hash = await bcrypt.hash(password, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G1b','31') RETURNING id", [randomUUID()])).rows[0].id;
  const actor = async (role = 'director', superAdmin = false) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'G1b','Synthetic',$2,'active',$3) RETURNING id", [email, hash, superAdmin])).rows[0].id;
    if (role) await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [org, id, role]);
    return { id, email };
  };
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/auth/`;
  const req = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json() };
  };
  const login = async (u, device) => { const r = await req('login', { email: u.email, password, ...(device ? { device_id: device } : {}) }); assert.equal(r.status, 200); return r.body; };
  const refresh = (token, device) => req('refresh', { refresh_token: token, ...(device ? { device_id: device } : {}) });
  const sessions = async u => (await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY id', [u.id])).rows;
  const live = rows => rows.filter(r => !r.revoked_at);
  const fixture = async () => { const u = await actor(); return { u, token: (await login(u)).refresh_token }; };
  const device = async u => (await db.query("INSERT INTO devices(organization_id,name,device_fingerprint,platform,registered_by) VALUES($1,'G1b',$2,'android',$3) RETURNING id", [org, randomUUID(), u.id])).rows[0].id;
  const denied = async (u, token, status, code, deviceId) => {
    const before = await sessions(u), r = await refresh(token, deviceId);
    assert.equal(r.status, status, JSON.stringify({ status: r.status, code: r.body.code })); if (code) assert.equal(r.body.code, code);
    assert.equal(r.body.access_token, undefined); assert.equal(r.body.refresh_token, undefined);
    assert.deepEqual(await sessions(u), before);
  };
  const pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  async function waitBlocked(n) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const r = await observer.query(`WITH RECURSIVE waiters(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
        UNION SELECT s.pid FROM pg_stat_activity s JOIN waiters w ON w.pid=ANY(pg_blocking_pids(s.pid))
      ) SELECT count(DISTINCT pid)::int AS n FROM waiters`, [pid]);
      if (r.rows[0].n >= n) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${n} real blocked refresh transactions`);
  }
  async function overlap(u, tokens, firstMustWait = false, mutate = async () => {}) {
    await db.query('BEGIN'); await db.query('SELECT id FROM sessions WHERE user_id=$1 FOR UPDATE', [u.id]);
    const work = [];
    let error;
    try {
      work.push(refresh(tokens[0]));
      if (firstMustWait) await waitBlocked(1);
      for (const token of tokens.slice(1)) work.push(refresh(token));
      await waitBlocked(tokens.length); await mutate();
    } catch (e) { error = e; }
    finally { await db.query('COMMIT'); }
    const replies = await Promise.all(work); if (error) throw error; return replies;
  }
  await check('normal rotation: one replacement, opaque hash only, same principal', async () => {
    const { u, token } = await fixture(), r = await refresh(token); assert.equal(r.status, 200);
    const rows = await sessions(u); assert.equal(rows.length, 2); assert.equal(live(rows).length, 1);
    assert.equal(rows.find(s => s.refresh_token_hash === hashToken(token)).revoked_reason, 'rotated');
    assert.equal(live(rows)[0].refresh_token_hash, hashToken(r.body.refresh_token)); assert.notEqual(token, r.body.refresh_token);
    assert.equal(JSON.stringify(rows).includes(r.body.refresh_token), false);
    assert.equal(r.body.user.id, u.id); assert.equal(r.body.user.organization_id, org);
    assert.equal(r.body.user.role, 'director'); assert.equal(r.body.expires_in, 900);
  });
  await check('same token overlap: at most one rotation, replay revokes its committed replacement', async () => {
    const { u, token } = await fixture(), replies = await overlap(u, [token, token]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 401]);
    assert.equal(replies.find(r => r.status === 401).body.code, 'SESSION_REUSE_DETECTED');
    const rows = await sessions(u); assert.equal(rows.length, 2); assert.equal(live(rows).length, 0);
    const winner = replies.find(r => r.status === 200).body.refresh_token;
    assert.equal((await refresh(winner)).body.code, 'SESSION_REUSE_DETECTED');
  });
  await check('distinct sessions may rotate concurrently without false reuse', async () => {
    const { u, token } = await fixture(), second = (await login(u)).refresh_token;
    const replies = await overlap(u, [token, second]); assert.deepEqual(replies.map(r => r.status), [200, 200]);
    const rows = await sessions(u); assert.equal(rows.length, 4); assert.equal(live(rows).length, 2);
    assert.notEqual(replies[0].body.refresh_token, replies[1].body.refresh_token);
  });
  await check('replay ordered before another session refresh cannot leave a new live descendant', async () => {
    const { u, token } = await fixture(); assert.equal((await refresh(token)).status, 200);
    const second = (await login(u)).refresh_token, before = await sessions(u);
    const replies = await overlap(u, [token, second], true);
    assert.deepEqual(replies.map(r => r.status), [401, 401]);
    assert.equal((await sessions(u)).length, before.length); assert.equal(live(await sessions(u)).length, 0);
  });
  await check('sequential replay revokes this user, never another user', async () => {
    const { u, token } = await fixture(), other = await fixture(), beforeOther = await sessions(other.u);
    assert.equal((await refresh(token)).status, 200); await login(u);
    const r = await refresh(token); assert.equal(r.status, 401); assert.equal(r.body.code, 'SESSION_REUSE_DETECTED');
    assert.equal(live(await sessions(u)).length, 0); assert.deepEqual(await sessions(other.u), beforeOther);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE user_id=$1 AND resource_label='reuse_detected'", [u.id])).rows[0].n, 1);
  });
  for (const [label, sql, status, code] of [
    ['expired', "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", 401, 'SESSION_EXPIRED'],
    ['device-revoked session', "UPDATE sessions SET revoked_at=NOW(),revoked_reason='device_revoked' WHERE user_id=$1", 403, 'DEVICE_REVOKED'],
    ['suspended', "UPDATE users SET status='suspended' WHERE id=$1", 403, 'ACCOUNT_SUSPENDED'],
    ['pending (existing refresh contract)', "UPDATE users SET status='pending' WHERE id=$1", 403, 'ACCOUNT_SUSPENDED'],
    ['deleted user', 'UPDATE users SET deleted_at=NOW() WHERE id=$1', 401, 'INVALID_REFRESH_TOKEN'],
  ]) await check(`${label}: denied without partial rotation`, async () => {
    const { u, token } = await fixture(); await db.query(sql, [u.id]); await denied(u, token, status, code);
  });
  await check('unknown opaque token: generic denial without mutation', async () => {
    const { u } = await fixture(); await denied(u, randomUUID(), 401, 'INVALID_REFRESH_TOKEN');
  });
  await check('empty token rejected by DTO', async () => { assert.equal((await refresh('')).status, 400); });
  await check('current role is used on renewal (not a stale access-token role)', async () => {
    const { u, token } = await fixture(); await db.query("UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='educator') WHERE user_id=$1", [u.id]);
    const r = await refresh(token); assert.equal(r.status, 200); assert.equal(r.body.user.role, 'educator');
    const payload = JSON.parse(Buffer.from(r.body.access_token.split('.')[1], 'base64url')); assert.deepEqual(payload.roles, ['educator']);
  });
  for (const [label, superAdmin] of [['platform admin', true], ['unattached active account', false]]) await check(`${label}: existing global issuance contract preserved`, async () => {
    const u = await actor(null, superAdmin), r = await refresh((await login(u)).refresh_token);
    assert.equal(r.status, 200); assert.equal(r.body.user.organization_id, null); assert.equal(r.body.user.role, superAdmin ? 'super_admin' : 'none');
  });
  for (const mode of ['preserve', 'explicit', 'attach']) await check(`valid device ${mode}: compatible with client bootstrap`, async () => {
    const u = await actor(), id = await device(u), token = (await login(u, mode === 'attach' ? undefined : id)).refresh_token;
    const r = await refresh(token, mode === 'preserve' ? undefined : id); assert.equal(r.status, 200);
    assert.equal(live(await sessions(u))[0].device_id, id);
  });
  for (const kind of ['expiry', 'session revocation', 'device revocation']) await check(`${kind} committed while refresh waits: no stale issuance`, async () => {
    const u = await actor(), id = await device(u), token = (await login(u, id)).refresh_token;
    const replies = await overlap(u, [token], false, async () => {
      if (kind === 'expiry') await db.query("UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id=$1", [u.id]);
      else if (kind === 'session revocation') await db.query("UPDATE sessions SET revoked_at=clock_timestamp(),revoked_reason='device_revoked' WHERE user_id=$1", [u.id]);
      else await db.query('UPDATE devices SET is_active=false,revoked_at=clock_timestamp() WHERE id=$1', [id]);
    });
    assert.equal(replies[0].status, kind === 'expiry' ? 401 : 403, JSON.stringify({ status: replies[0].status, code: replies[0].body.code }));
    assert.equal(replies[0].body.code, kind === 'expiry' ? 'SESSION_EXPIRED' : 'DEVICE_REVOKED');
    assert.equal((await sessions(u)).length, 1);
    if (kind !== 'session revocation') assert.equal((await sessions(u))[0].revoked_at, null);
  });
  const failure = await fixture();
  await db.query(`CREATE FUNCTION g1b_test_session_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.user_id='${failure.u.id}'::uuid THEN RAISE EXCEPTION 'G1b synthetic session storage failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER g1b_test_session_failure BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION g1b_test_session_failure()`);
  try { await check('replacement INSERT failure rolls back revocation', () => denied(failure.u, failure.token, 500)); }
  finally { await db.query('DROP TRIGGER g1b_test_session_failure ON sessions; DROP FUNCTION g1b_test_session_failure()'); }
  await check('original refresh still usable after storage is restored', async () => { assert.equal((await refresh(failure.token)).status, 200); });
  const replay = await fixture(); assert.equal((await refresh(replay.token)).status, 200);
  await db.query(`CREATE FUNCTION g1b_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.user_id='${replay.u.id}'::uuid AND NEW.resource_label='reuse_detected'
    THEN RAISE EXCEPTION 'G1b synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER g1b_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION g1b_test_audit_failure()`);
  try { await check('replay revocation remains committed despite legacy best-effort audit failure', async () => {
    const r = await refresh(replay.token); assert.equal(r.status, 401); assert.equal(r.body.code, 'SESSION_REUSE_DETECTED'); assert.equal(live(await sessions(replay.u)).length, 0);
  }); } finally { await db.query('DROP TRIGGER g1b_test_audit_failure ON audit_logs; DROP FUNCTION g1b_test_audit_failure()'); }
} finally { if (app) await app.close(); if (pool) await pool.end(); await observer.end(); await db.end(); }
console.log(`G1b refresh rotation: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
