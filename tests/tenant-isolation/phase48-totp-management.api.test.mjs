#!/usr/bin/env node
// G1d: actual HTTP/PG account settings + public RFC vectors (no mock TOTP or SQL).
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
  const password = 'Synthetic-G1d-only!', hash = await bcrypt.hash(password, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G1d','31') RETURNING id", [randomUUID()])).rows[0].id;
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', MAX_LOGIN_ATTEMPTS: '5', ACCOUNT_LOCK_MINUTES: '15', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  const { TotpService } = await import('../../apps/api/dist/modules/identity/totp.service.js');
  const totp = new TotpService(), known = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  await check('RFC4226 SHA1 HOTP vectors with six digits', async () => {
    for (const [counter, code] of ['755224','287082','359152','969429','338314','254676','287922','162583','399871','520489'].entries()) assert.equal(totp.generate(known, counter), code);
  });
  await check('RFC6238 SHA1 vectors truncated to the configured six digits', async () => {
    for (const [time, code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']]) assert.equal(totp.generate(known, Math.floor(time / 30)), code);
  });
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/auth/`;
  const req = async (path, u, body = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(u?.token ? { authorization: `Bearer ${u.token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json() };
  };
  const fixture = async (enabled = false, secret = known) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'G1d','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [org, id]);
    const login = await req('login', null, { email, password }); assert.equal(login.status, 200);
    await db.query('UPDATE users SET totp_secret=$2,totp_enabled=$3 WHERE id=$1', [id, secret, enabled]);
    return { id, email, token: login.body.access_token };
  };
  const row = async u => (await db.query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
  const audit = async u => (await db.query("SELECT * FROM audit_logs WHERE user_id=$1 AND (new_values ? 'totp_enabled' OR new_values ? 'totp_setup') ORDER BY id", [u.id])).rows;
  const snapshot = async u => {
    const user = await row(u);
    // Never print even synthetic enrollment secrets in assertion diffs.
    user.totp_secret = user.totp_secret ? createHash('sha256').update(user.totp_secret).digest('hex') : null;
    return { user, audit: await audit(u), sessions: (await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY id', [u.id])).rows };
  };
  const settings = (action, u, code) => req(`2fa/${action}`, u, code ? { code } : {});
  const wrong = () => {
    const c = Math.floor(Date.now() / 30000), codes = new Set([-2,-1,0,1,2].map(d => totp.generate(known, c+d)));
    return ['000000','111111','222222','333333','444444','555555'].find(code => !codes.has(code));
  };
  async function denied(u, action, status, code) {
    const before = await snapshot(u), r = await settings(action, u, action === 'enable' ? undefined : totp.generate(known));
    assert.equal(r.status, status, JSON.stringify({ status: r.status, code: r.body.code }));
    if (code) assert.equal(r.body.code, code);
    assert.equal(r.body.secret, undefined); assert.equal(r.body.otpauth_url, undefined); assert.deepEqual(await snapshot(u), before);
  }
  for (const status of ['active','pending']) {
    const u = await fixture(false, null); await db.query('UPDATE users SET status=$2 WHERE id=$1', [u.id, status]);
    let secret;
    await check(`${status}: initial setup has a real secret and minimized audit`, async () => {
      const r = await settings('enable', u); assert.equal(r.status, 200); secret = r.body.secret;
      assert.match(secret, /^[A-Z2-7]{32}$/); assert.ok(r.body.otpauth_url.includes(`secret=${secret}`));
      assert.ok((await row(u)).totp_secret === secret); assert.equal((await row(u)).totp_enabled, false);
      const logs = await audit(u); assert.equal(logs.length, 1); assert.deepEqual(logs[0].new_values, { totp_setup: true });
      assert.equal(logs[0].resource_id, u.id); assert.equal(JSON.stringify(logs).includes(secret), false);
    });
    await check(`${status}: confirmation then normal disable remain available`, async () => {
      assert.ok(secret); assert.equal((await settings('verify', u, totp.generate(secret))).status, 200);
      assert.equal((await row(u)).totp_enabled, true);
      assert.equal((await settings('disable', u, totp.generate(secret))).status, 200);
      const state = await row(u); assert.equal(state.totp_enabled, false); assert.equal(state.totp_secret, null);
    });
  }
  await check('pending setup retry keeps the same secret without rewriting state', async () => {
    const u = await fixture(false), before = await snapshot(u), r = await settings('enable', u);
    assert.equal(r.status, 200); assert.ok(r.body.secret === known); assert.deepEqual(await snapshot(u), before);
  });
  await check('enabled factor secret is never returned by setup', async () => {
    const u = await fixture(true); await denied(u, 'enable', 409, 'TOTP_ALREADY_ENABLED');
  });
  for (const [name, sql, status, code] of [
    ['suspended', "UPDATE users SET status='suspended' WHERE id=$1", 403, 'ACCOUNT_SUSPENDED'],
    ['deleted', 'UPDATE users SET deleted_at=NOW() WHERE id=$1', 401, 'INVALID_CREDENTIALS'],
    ['locked', "UPDATE users SET locked_until=NOW()+INTERVAL '10 minutes' WHERE id=$1", 423, 'ACCOUNT_LOCKED'],
  ]) for (const action of ['enable','verify','disable']) await check(`${name}: ${action} refused with no secret or mutation`, async () => {
    const u = await fixture(action === 'disable'); await db.query(sql, [u.id]); await denied(u, action, status, code);
  });
  const pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  async function overlap(u, action, bodies, beforeRequests = async () => {}, beforeRelease = async () => {}) {
    await db.query('BEGIN'); await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
    await beforeRequests();
    const work = Promise.all(bodies.map(code => settings(action, u, code))); let blocked = false;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const r = await observer.query(`WITH RECURSIVE w(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION SELECT s.pid FROM pg_stat_activity s JOIN w ON w.pid=ANY(pg_blocking_pids(s.pid))
        ) SELECT count(DISTINCT pid)::int n FROM w`, [pid]);
        if (r.rows[0].n >= bodies.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { try { await beforeRelease(); } finally { await db.query('COMMIT'); } }
    const replies = await work; assert.ok(blocked, 'all requests actually overlap'); return replies;
  }
  for (const [name, sql, status] of [
    ['suspension', "UPDATE users SET status='suspended' WHERE id=$1", 403],
    ['deletion', 'UPDATE users SET deleted_at=NOW() WHERE id=$1', 401],
    ['lockout', "UPDATE users SET locked_until=NOW()+INTERVAL '10 minutes' WHERE id=$1", 423],
  ]) for (const action of ['enable','verify','disable']) await check(`${action}: ${name} committed during actual PG wait is honored`, async () => {
    const u = await fixture(action === 'disable'); let before;
    const replies = await overlap(u, action, [action === 'enable' ? undefined : totp.generate(known)], async () => {
      await db.query(sql, [u.id]); before = await snapshot(u);
    });
    assert.equal(replies[0].status, status); assert.equal(replies[0].body.secret, undefined); assert.deepEqual(await snapshot(u), before);
  });
  await check('concurrent invalid proofs stop at the configured account threshold', async () => {
    const u = await fixture(false), replies = await overlap(u, 'verify', Array(7).fill(wrong()));
    assert.deepEqual(replies.map(r => r.status).sort(), [401,401,401,401,401,423,423]);
    assert.equal((await row(u)).failed_attempts, 5); assert.ok((await row(u)).locked_until);
  });
  await check('confirmation queued behind cancellation cannot resurrect a factor without a secret', async () => {
    const u = await fixture(false), code = totp.generate(known);
    await db.query('BEGIN'); await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
    const work = []; let observed = 0;
    try {
      for (const action of ['disable','verify']) {
        work.push(settings(action, u, code)); const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const r = await observer.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock'", [new URL(appUrl()).username]);
          if (r.rows[0].n >= work.length) { observed++; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
    } finally { await db.query('COMMIT'); }
    const replies = await Promise.all(work); assert.equal(observed, 2);
    assert.deepEqual(replies.map(r => r.status), [200,401]);
    const state = await row(u); assert.equal(state.totp_enabled, false); assert.equal(state.totp_secret, null); assert.equal((await audit(u)).length, 1);
  });
  await check('a lock expiring during PG wait starts a fresh failed-proof window', async () => {
    const u = await fixture(false); let expiry;
    const replies = await overlap(u, 'verify', [wrong()], async () => {
      expiry = (await db.query("UPDATE users SET failed_attempts=5,locked_until=clock_timestamp()+INTERVAL '1 second' WHERE id=$1 RETURNING locked_until", [u.id])).rows[0].locked_until;
    }, async () => {
      while (!(await observer.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [expiry])).rows[0].expired) await new Promise(resolve => setTimeout(resolve, 20));
    });
    assert.equal(replies[0].status, 401); const state = await row(u);
    assert.equal(state.failed_attempts, 1); assert.equal(state.locked_until, null);
  });
  await check('concurrent initial setup returns one persisted secret and one audit', async () => {
    const u = await fixture(false, null), replies = await overlap(u, 'enable', [undefined, undefined]);
    assert.ok(replies.every(r => r.status === 200));
    const persisted = (await row(u)).totp_secret;
    assert.ok(replies.every(r => r.body.secret === persisted), 'every returned secret must match persisted enrollment');
    assert.equal((await audit(u)).length, 1);
  });
  await check('concurrent confirmation creates only one state-change audit', async () => {
    const u = await fixture(false), code = totp.generate(known), replies = await overlap(u, 'verify', [code, code]);
    assert.ok(replies.every(r => r.status === 200)); assert.equal((await row(u)).totp_enabled, true); assert.equal((await audit(u)).length, 1);
  });
  for (const action of ['verify','disable']) await check(`${action}: invalid proofs increment account counter and enforce lockout`, async () => {
    const u = await fixture(action === 'disable'), code = wrong();
    for (let i = 0; i < 5; i++) assert.equal((await settings(action, u, code)).status, 401);
    const state = await row(u); assert.equal(state.failed_attempts, 5); assert.ok(state.locked_until);
    await denied(u, action, 423, 'ACCOUNT_LOCKED');
  });
  await check('password login with wrong TOTP contributes to the shared lockout counter', async () => {
    const u = await fixture(true), code = wrong();
    for (let i = 0; i < 5; i++) assert.equal((await req('login', null, { email: u.email, password, totp_code: code })).status, 401);
    assert.equal((await row(u)).failed_attempts, 5);
    assert.equal((await req('login', null, { email: u.email, password, totp_code: totp.generate(known) })).status, 423);
  });
  await check('correct password and TOTP still create a session', async () => {
    const u = await fixture(true), r = await req('login', null, { email: u.email, password, totp_code: totp.generate(known) });
    assert.equal(r.status, 200); assert.ok(r.body.access_token); assert.equal((await row(u)).failed_attempts, 0);
  });
  for (const action of ['enable','verify','disable']) {
    const u = await fixture(action === 'disable', action === 'enable' ? null : known);
    await db.query(`CREATE FUNCTION g1d_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${u.id}'::uuid THEN RAISE EXCEPTION 'G1d synthetic audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER g1d_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION g1d_test_audit_failure()`);
    try { await check(`${action}: audit storage failure rolls back factor change`, () => denied(u, action, 500)); }
    finally { await db.query('DROP TRIGGER g1d_test_audit_failure ON audit_logs; DROP FUNCTION g1d_test_audit_failure()'); }
  }
  await check('missing factor cannot be confirmed or disabled', async () => {
    const u = await fixture(false, null);
    await denied(u, 'verify', 401, 'TOTP_INVALID'); await denied(u, 'disable', 401, 'TOTP_INVALID');
  });
  await check('expired lock allows recovery with a valid TOTP', async () => {
    const u = await fixture(false); await db.query("UPDATE users SET failed_attempts=5,locked_until=NOW()-INTERVAL '1 second' WHERE id=$1", [u.id]);
    assert.equal((await settings('verify', u, totp.generate(known))).status, 200);
    const state = await row(u); assert.equal(state.failed_attempts, 0); assert.equal(state.locked_until, null);
  });
  await check('without access token settings remain inaccessible', async () => {
    for (const action of ['enable','verify','disable']) assert.equal((await settings(action, null, wrong())).status, 401);
  });
  for (const action of ['enable','verify','disable']) await check(`${action}: actual HTTP request limit is enforced`, async () => {
    const u = await fixture(action !== 'enable'), code = wrong(); process.env.RATE_LIMIT_DISABLED = 'false';
    try {
      const replies = [];
      for (let i = 0; i < 6; i++) replies.push(await settings(action, u, action === 'enable' ? undefined : code));
      assert.ok(replies.slice(0,5).every(r => r.status !== 429)); assert.equal(replies[5].status, 429); assert.equal(replies[5].body.code, 'RATE_LIMITED');
    } finally { process.env.RATE_LIMIT_DISABLED = 'true'; }
  });
} finally { if (app) await app.close(); if (pool) await pool.end(); await observer.end(); await db.end(); }
console.log(`G1d TOTP management: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
