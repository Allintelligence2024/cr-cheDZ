#!/usr/bin/env node
// H2h: real HTTP writes + PG state, no object-store call. Fresh *_test required.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}: ${error.stack}`); }
}
try {
  await ensureAppRole(db);
  const password = 'Synthetic-H2h-only!', hash = await bcrypt.hash(password, 4);
  const org = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2h','31') RETURNING id", [randomUUID()])).rows[0].id;
  const a = await org(), b = await org();
  const actor = async (role, tenant = a) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2h','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), admin = await actor('super_admin'), foreign = await actor('director', b);
  const accountant = await actor('accountant'), educator = await actor('educator'), parent = await actor('parent_primary');
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, body: await r.json() };
  };
  for (const user of [director, admin, foreign, accountant, educator, parent]) {
    const r = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(r.status, 200); user.token = r.body.access_token; assert.ok(user.token);
  }
  const profile = async user => {
    const r = await req('POST', '/staff', user, { user_id: user.id, qualification: 'director', hire_date: '2026-01-01' });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
  };
  const staff = await profile(director), otherStaff = await profile(foreign);
  const snapshot = async () => ({
    docs: (await db.query('SELECT * FROM staff_documents WHERE staff_id=ANY($1::uuid[]) ORDER BY id', [[staff, otherStaff]])).rows,
    audit: (await db.query("SELECT * FROM audit_logs WHERE organization_id=ANY($1::uuid[]) AND resource_type='staff_document' ORDER BY id", [[a, b]])).rows,
  });
  const post = (user, key, target = staff) => req('POST', `/staff/${target}/documents`, user, { document_type: 'diploma', title: `H2h ${randomUUID()}`, storage_key: key });
  const keys = [
    ['own document', `${a}/document/diploma.pdf`, true],
    ['nested document', `${a}/staff/${staff}/contract.pdf`, true],
    ['root-level filename', `${a}/diploma.pdf`, true],
    ['foreign tenant', `${b}/document/private.pdf`, false],
    ['unprefixed', 'staff/diploma.pdf', false],
    ['absolute URL', `https://storage.invalid/${a}/document.pdf`, false],
    ['leading slash', `/${a}/document.pdf`, false],
    ['bare tenant', a, false],
    ['lookalike prefix', `${a}-other/document.pdf`, false],
    ['encoded separator', `${a}%2Fdocument.pdf`, false],
    ['leading whitespace', ` ${a}/document.pdf`, false],
  ];
  for (const [role, user] of [['director', director], ['super_admin tenant', admin]]) {
    for (const [label, key, allowed] of keys) await check(`${role}: ${label}, HTTP + persistence + audit`, async () => {
      const before = await snapshot(), r = await post(user, key);
      const after = await snapshot();
      assert.equal(r.status, allowed ? 201 : 400, JSON.stringify({ response: r.body, documents_added: after.docs.length - before.docs.length, audits_added: after.audit.length - before.audit.length }));
      if (allowed) {
        assert.equal(after.docs.length, before.docs.length + 1); assert.equal(after.audit.length, before.audit.length + 1);
        const row = after.docs.find(row => row.id === r.body.id); assert.ok(row);
        assert.equal(row.storage_key, key); assert.equal(row.organization_id, a); assert.equal(row.staff_id, staff);
        assert.equal(after.audit.find(row => row.resource_id === r.body.id).user_id, user.id);
        assert.equal(r.body.storage_key, undefined);
      } else {
        assert.equal(r.body.code, 'STORAGE_KEY_TENANT_MISMATCH'); assert.deepEqual(after, before);
      }
    });
  }
  for (const [label, user] of [['accountant', accountant], ['educator', educator], ['parent', parent]]) await check(`${label} still cannot create staff document`, async () => {
    const before = await snapshot(); assert.equal((await post(user, `${a}/document/valid.pdf`)).status, 403); assert.deepEqual(await snapshot(), before);
  });
  for (const [label, user, key, target] of [
    ['foreign staff', director, `${a}/document/a.pdf`, otherStaff],
    ['foreign actor', foreign, `${b}/document/b.pdf`, staff],
    ['missing staff', director, `${a}/document/a.pdf`, randomUUID()],
  ]) await check(`${label}: 404 without business mutation`, async () => {
    const before = await snapshot(); assert.equal((await post(user, key, target)).status, 404); assert.deepEqual(await snapshot(), before);
  });
  await check('other tenant can create its own document', async () => {
    const r = await post(foreign, `${b}/document/b.pdf`, otherStaff); assert.equal(r.status, 201);
    const row = (await db.query('SELECT organization_id,staff_id,storage_key FROM staff_documents WHERE id=$1', [r.body.id])).rows[0];
    assert.deepEqual(row, { organization_id: b, staff_id: otherStaff, storage_key: `${b}/document/b.pdf` });
  });
  await check('accountant retains minimized document list', async () => {
    const r = await req('GET', `/staff/${staff}/documents`, accountant); assert.equal(r.status, 200); assert.ok(r.body.items.length >= 6);
    for (const row of r.body.items) assert.equal(row.storage_key, undefined);
  });
  await check('other tenant cannot list staff documents', async () => {
    const r = await req('GET', `/staff/${staff}/documents`, foreign); assert.equal(r.status, 200); assert.deepEqual(r.body.items, []);
  });
  await check('historical keys are retained, not rewritten or purged', async () => {
    const id = (await db.query("INSERT INTO staff_documents(organization_id,staff_id,document_type,title,storage_key) VALUES($1,$2,'diploma','Historical H2h','legacy/staff.pdf') RETURNING id", [a, staff])).rows[0].id;
    const r = await post(director, `${a}/document/new.pdf`); assert.equal(r.status, 201);
    assert.equal((await db.query('SELECT storage_key FROM staff_documents WHERE id=$1', [id])).rows[0].storage_key, 'legacy/staff.pdf');
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`H2h staff document scope: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
