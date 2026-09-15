#!/usr/bin/env node
// G3a: real HTTP + production-role PG, independent actors and atomic audit.
// Fresh synthetic *_test only; admin is used solely for fixtures/observations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const observer = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect(); await observer.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
try {
  await ensureAppRole(db);
  const password = 'Synthetic-G3-only!', hash = await bcrypt.hash(password, 4);
  const org = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G3','31') RETURNING id", [randomUUID()])).rows[0].id;
  const a = await org(), b = await org();
  const actor = async (role, tenant = a) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'G3','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const author = await actor('director'), reviewer = await actor('director'), admin = await actor('super_admin');
  const foreign = await actor('director', b), accountant = await actor('accountant'), educator = await actor('educator'), parent = await actor('parent_primary');
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json() };
  };
  for (const u of [author, reviewer, admin, foreign, accountant, educator, parent]) {
    const r = await req('POST', '/auth/login', null, { email: u.email, password });
    assert.equal(r.status, 200); u.token = r.body.access_token; assert.ok(u.token);
  }
  const registry = (await req('GET', '/privacy/registry', author)).body[0].id;
  const otherRegistry = (await db.query(`INSERT INTO processing_registry(organization_id,processing_name,purpose_fr,legal_basis,data_categories,data_subjects,retention_days)
    VALUES($1,'G3 private registry','Synthetic','consent','{}','{}',30) RETURNING id`, [b])).rows[0].id;
  assert.notEqual(otherRegistry, registry);
  const create = (u = author, target = registry) => req('POST', '/privacy/dpias', u, { processing_registry_id: target, risk_assessment: { free_text: 'Sensitive synthetic assessment, not for audit' }, mitigation_measures: ['Synthetic internal measure'] });
  const draft = async (u = author) => { const r = await create(u); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; };
  const approve = (u, id) => req('POST', `/privacy/dpias/${id}/approve`, u, {});
  const row = async id => (await db.query('SELECT * FROM privacy_dpias WHERE id=$1', [id])).rows[0];
  const audits = async id => (await db.query("SELECT * FROM audit_logs WHERE resource_type='privacy_dpia' AND resource_id=$1 ORDER BY occurred_at,id", [id])).rows;
  const snapshot = async () => ({ dpias: (await db.query('SELECT * FROM privacy_dpias WHERE organization_id=ANY($1::uuid[]) ORDER BY id', [[a, b]])).rows, audit: (await db.query("SELECT * FROM audit_logs WHERE organization_id=ANY($1::uuid[]) AND resource_type='privacy_dpia' ORDER BY id", [[a, b]])).rows });
  const denied = async (operation, status, code) => {
    const before = await snapshot(), r = await operation();
    assert.equal(r.status, status, JSON.stringify(r.body));
    if (code) assert.equal(r.body.code, code);
    assert.deepEqual(await snapshot(), before);
  };
  for (const [label, u] of [['director', author], ['tenant super_admin', admin]]) {
    await check(`${label}: creation records actor and one minimized audit`, async () => {
      const id = await draft(u), d = await row(id), log = await audits(id);
      assert.equal(d.created_by, u.id); assert.equal(d.status, 'draft'); assert.equal(log.length, 1);
      assert.equal(log[0].action, 'create'); assert.equal(log[0].organization_id, a); assert.equal(log[0].user_id, u.id);
      assert.deepEqual(log[0].new_values, { status: 'draft', processing_registry_id: registry });
      assert.equal(JSON.stringify(log).includes('Sensitive synthetic'), false);
    });
    const own = await draft(u);
    await check(`${label}: cannot approve own declaration`, () => denied(() => approve(u, own), 403, 'DPIA_SELF_APPROVAL_FORBIDDEN'));
    await check(`${label}: can independently approve another actor's declaration`, async () => {
      const id = await draft(reviewer), r = await approve(u, id), d = await row(id), log = await audits(id);
      assert.equal(r.status, 201); assert.equal(d.status, 'approved'); assert.equal(d.approved_by, u.id); assert.ok(d.approved_at); assert.ok(d.review_date);
      assert.equal(log.length, 2); const approval = log.find(l => l.action === 'approve'); assert.ok(approval);
      assert.equal(approval.user_id, u.id); assert.equal(approval.organization_id, a);
      assert.deepEqual(approval.old_values, { status: 'draft' }); assert.deepEqual(approval.new_values, { status: 'approved' });
    });
  }
  const approvedId = await draft(); assert.equal((await approve(reviewer, approvedId)).status, 201);
  for (const [label, u] of [['same reviewer', reviewer], ['different reviewer', admin]]) await check(`${label}: retry preserves first approval and audit`, async () => {
    const before = await snapshot(), r = await approve(u, approvedId);
    assert.equal(r.status, 201); assert.equal(r.body.approved_at, (await row(approvedId)).approved_at.toISOString()); assert.deepEqual(await snapshot(), before);
  });
  await check('author cannot self-approve even after another reviewer approved', () => denied(() => approve(author, approvedId), 403, 'DPIA_SELF_APPROVAL_FORBIDDEN'));
  await check('overlapping reviewers produce one immutable approval and one approval audit', async () => {
    const id = await draft(), pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await db.query('BEGIN'); await db.query('SELECT id FROM privacy_dpias WHERE id=$1 FOR UPDATE', [id]);
    const work = Promise.all([approve(reviewer, id), approve(admin, id)]);
    let blocked = false;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        // Recursive blockers include a backend waiting behind the other reviewer.
        const r = await observer.query(`WITH RECURSIVE waiters(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION SELECT s.pid FROM pg_stat_activity s JOIN waiters w ON w.pid=ANY(pg_blocking_pids(s.pid))
        ) SELECT count(DISTINCT pid)::int AS n FROM waiters`, [pid]);
        if (r.rows[0].n >= 2) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await db.query('COMMIT'); }
    const replies = await work; assert.ok(blocked, 'both real HTTP transactions must overlap');
    for (const r of replies) assert.equal(r.status, 201);
    assert.deepEqual(replies[0].body, replies[1].body);
    const d = await row(id), log = (await audits(id)).filter(l => l.action === 'approve');
    assert.ok([reviewer.id, admin.id].includes(d.approved_by)); assert.equal(log.length, 1); assert.equal(log[0].user_id, d.approved_by);
  });
  const pending = await draft();
  for (const [label, change, restore] of [
    ['suspended user', "UPDATE users SET status='suspended' WHERE id=$1", "UPDATE users SET status='active' WHERE id=$1"],
    ['deleted user', 'UPDATE users SET deleted_at=NOW() WHERE id=$1', 'UPDATE users SET deleted_at=NULL WHERE id=$1'],
    ['inactive membership', 'UPDATE memberships SET is_active=false WHERE user_id=$1', 'UPDATE memberships SET is_active=true WHERE user_id=$1'],
    ['downgraded role with old JWT', "UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='educator') WHERE user_id=$1", "UPDATE memberships SET role_id=(SELECT id FROM roles WHERE slug='director') WHERE user_id=$1"],
  ]) {
    await db.query(change, [reviewer.id]);
    try {
      await check(`${label}: cannot create`, () => denied(() => create(reviewer), 403, 'DPIA_ACTOR_FORBIDDEN'));
      await check(`${label}: cannot approve`, () => denied(() => approve(reviewer, pending), 403, 'DPIA_ACTOR_FORBIDDEN'));
    } finally { await db.query(restore, [reviewer.id]); }
  }
  for (const [label, u] of [['accountant', accountant], ['educator', educator], ['parent', parent]]) {
    await check(`${label}: creation still forbidden`, () => denied(() => create(u), 403));
    await check(`${label}: approval still forbidden`, () => denied(() => approve(u, pending), 403));
  }
  await check('foreign registry rejected without write', () => denied(() => create(author, otherRegistry), 404));
  await check('foreign reviewer rejected without write', () => denied(() => approve(foreign, pending), 404));
  await check('missing DPIA returns 404', () => denied(() => approve(reviewer, randomUUID()), 404));
  await check('in_review remains approvable with its original state audited', async () => {
    const id = await draft(); await db.query("UPDATE privacy_dpias SET status='in_review' WHERE id=$1", [id]);
    assert.equal((await approve(reviewer, id)).status, 201);
    assert.deepEqual((await audits(id)).find(l => l.action === 'approve')?.old_values, { status: 'in_review' });
  });
  await check('unknown state cannot silently become approved', async () => {
    const id = await draft(); await db.query("UPDATE privacy_dpias SET status='withdrawn' WHERE id=$1", [id]);
    await denied(() => approve(reviewer, id), 409, 'DPIA_STATE_CONFLICT');
  });
  const { AuditService } = await import('../../apps/api/dist/modules/privacy/audit.service.js');
  const auditService = app.get(AuditService);
  await check('shared audit writer preserves legacy redaction', async () => {
    const id = randomUUID();
    await auditService.log({ organizationId: a, userId: author.id, action: 'update', resourceType: 'privacy_dpia', resourceId: id,
      newValues: { phone: 'synthetic-phone', token: 'synthetic-token', health_note: 'synthetic-health', status: 'draft' } });
    const log = await audits(id); assert.equal(log.length, 1);
    assert.deepEqual(log[0].new_values, { phone: '[REDACTED]', token: '[REDACTED]', health_note: '[REDACTED]', status: 'draft' });
  });
  // Controlled storage failure, not a mock audit service: HTTP must roll back PG.
  await db.query(`CREATE FUNCTION g3_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.organization_id='${a}'::uuid AND NEW.resource_type='privacy_dpia'
    THEN RAISE EXCEPTION 'G3 synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER g3_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION g3_test_audit_failure()`);
  try {
    await check('legacy best-effort audit still absorbs a real storage failure', async () => {
      const before = await snapshot();
      await auditService.log({ organizationId: a, userId: author.id, action: 'update', resourceType: 'privacy_dpia', resourceId: randomUUID() });
      assert.deepEqual(await snapshot(), before);
    });
    await check('audit storage failure rolls back creation', () => denied(() => create(author), 500));
    await check('audit storage failure rolls back approval', () => denied(() => approve(reviewer, pending), 500));
  } finally { await db.query('DROP TRIGGER g3_test_audit_failure ON audit_logs; DROP FUNCTION g3_test_audit_failure()'); }
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await observer.end(); await db.end();
}
console.log(`G3 DPIA approval: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
