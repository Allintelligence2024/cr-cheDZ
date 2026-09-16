#!/usr/bin/env node
// H2f: real HTTP + PostgreSQL. Fresh *_test, production-role helpers, no reset here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const url = process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: url }); await db.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}: ${error.stack}`); }
}
try {
  await ensureAppRole(db);
  const password = 'Synthetic-H2f-only!', hash = await bcrypt.hash(password, 4);
  const makeOrg = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2f','31') RETURNING id", [randomUUID()])).rows[0].id;
  const org = await makeOrg(), other = await makeOrg();
  const actor = async (role, tenant = org) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2f','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    const membership = (await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3 RETURNING *', [tenant, id, role])).rows[0];
    return { id, email, role, membership };
  };
  const director = await actor('director'), parent = await actor('parent_primary'), accountant = await actor('accountant'), operator = await actor('super_admin'), peer = await actor('parent_primary'), foreign = await actor('director', other);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2f') RETURNING id", [org])).rows[0].id;
  const child = (await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'H2F_CHILD','Synthetic','2024-01-01',$3) RETURNING id", [org, site, director.id])).rows[0].id;
  for (const user of [parent, accountant]) {
    user.guardian = (await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'H2f','Synthetic','parent',$3) RETURNING id", [org, user.id, director.id])).rows[0].id;
    user.link = (await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health,can_receive_invoices) VALUES($1,$2,$3,true,true,true) RETURNING id', [org, child, user.guardian])).rows[0].id;
  }
  await db.query("INSERT INTO health_records(organization_id,child_id,blood_type,general_notes) VALUES($1,$2,'O+','H2F_MEDICAL_SECRET')", [org, child]);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  };
  const actors = [parent, accountant, director, operator];
  for (const user of [...actors, peer, foreign]) {
    const response = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(response.status, 200); user.token = response.body.access_token; assert.ok(user.token);
  }
  for (const user of actors) {
    const response = await req('POST', '/privacy/requests', user, { request_type: 'access', subject_id: child, notes: 'H2F_OWN_REQUEST_NOTE' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); user.request = response.body.id;
  }
  const snapshot = await req('POST', `/privacy/requests/${parent.request}/export`, parent);
  assert.equal(snapshot.status, 201); assert.equal(snapshot.body.payload.health_record.general_notes, 'H2F_MEDICAL_SECRET');
  const stateInDb = async (id) => (await db.query(`SELECT
    (SELECT count(*)::int FROM privacy_requests WHERE organization_id=$1) AS requests,
    (SELECT count(*)::int FROM privacy_request_exports WHERE organization_id=$1) AS exports,
    status, resolved_by, resolved_at FROM privacy_requests WHERE id=$2`, [org, id])).rows[0];
  for (const user of actors) for (const state of ['authorized', 'membership inactive', 'membership absent', 'user suspended', 'user deleted', 'restored']) {
    if (state === 'membership inactive') await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [org, user.id]);
    if (state === 'membership absent') await db.query('DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2', [org, user.id]);
    if (state === 'user suspended') await db.query("UPDATE users SET status='suspended' WHERE id=$1", [user.id]);
    if (state === 'user deleted') await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [user.id]);
    const inactive = !['authorized', 'restored'].includes(state);
    const routes = [
      ['create child request', 'POST', '/privacy/requests', { request_type: 'access', subject_id: child }],
      ['create personal request', 'POST', '/privacy/requests', { request_type: 'rectification', notes: 'personal' }],
      ['list', 'GET', '/privacy/requests'],
      ['detail', 'GET', `/privacy/requests/${user.request}`],
      ['export', 'POST', `/privacy/requests/${user.request}/export`],
      ['resolve', 'POST', `/privacy/requests/${user.request}/resolve`],
    ];
    try {
      for (const [name, method, path, body] of routes) await check(`${user.role}/${state}: ${name}`, async () => {
        await db.query("UPDATE privacy_requests SET status='pending',resolved_at=NULL,resolved_by=NULL WHERE id=$1", [user.request]);
        const before = await stateInDb(user.request);
        const response = await req(method, path, user, body);
        const after = await stateInDb(user.request);
        const denied = inactive || (name === 'resolve' && !['director', 'super_admin'].includes(user.role));
        // G4 (migration 062) : membership inactive/absent, suspension et
        // suppression douce sont des événements révocatoires — l'époque du JWT
        // est dépassée par le déclencheur DB et le refus survient AU GARDE
        // D'ENTRÉE (401), plus tôt que le 403 métier de l'endpoint. Les deux
        // codes restent des refus SANS mutation, ce que le snapshot prouve.
        const guardRevoked = ['membership inactive', 'membership absent', 'user suspended', 'user deleted'].includes(state);
        if (denied) {
          if (guardRevoked) assert.equal(response.status, 401, JSON.stringify({ status: response.status, before, after }));
          else assert.equal(response.status, 403, JSON.stringify({ status: response.status, before, after }));
          assert.deepEqual(after, before, 'denied calls cannot create requests/exports or resolve a request');
          assert.ok(!JSON.stringify(response.body).includes('H2F_'));
        } else {
          assert.equal(response.status, method === 'POST' ? 201 : 200, JSON.stringify(response.body));
          if (name.startsWith('create')) assert.equal(after.requests, before.requests + 1);
          if (name === 'list') assert.ok(response.body.some(row => row.id === user.request));
          if (name === 'detail') assert.equal(response.body.id, user.request);
          if (name === 'export') {
            assert.equal(after.exports, before.exports + 1); assert.equal(response.body.payload.health_record.general_notes, 'H2F_MEDICAL_SECRET');
            assert.deepEqual((await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1', [response.body.export_id])).rows[0].payload, response.body.payload);
          }
          if (name === 'resolve') { assert.equal(after.status, 'resolved'); assert.equal(after.resolved_by, user.id); }
        }
      });
    } finally {
      await db.query("UPDATE users SET status='active',deleted_at=NULL WHERE id=$1", [user.id]);
      if (state === 'membership absent') await db.query('INSERT INTO memberships SELECT * FROM json_populate_record(NULL::memberships,$1::json)', [JSON.stringify(user.membership)]);
      await db.query('UPDATE memberships SET is_active=true WHERE organization_id=$1 AND user_id=$2', [org, user.id]);
      // G4 : le rétablissement bump aussi l'époque (changement réel) —
      // reconnexion exigée pour la suite du matrix ; sans flip, no-op (le
      // déclencheur ne frappe que les différences de valeurs).
      if (['membership inactive', 'membership absent', 'user suspended', 'user deleted'].includes(state)) {
        const r = await req('POST', '/auth/login', null, { email: user.email, password });
        assert.equal(r.status, 200, `${state}: relogin after restore`); user.token = r.body.access_token;
      }
    }
  }
  await check('active requester can retain own case history after guardian deletion, not fresh child access', async () => {
    await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1', [parent.guardian]);
    try {
      const list = await req('GET', '/privacy/requests', parent); assert.equal(list.status, 200); assert.ok(list.body.some(row => row.id === parent.request));
      const detail = await req('GET', `/privacy/requests/${parent.request}`, parent); assert.equal(detail.status, 200); assert.equal(detail.body.notes, 'H2F_OWN_REQUEST_NOTE');
      const before = await stateInDb(parent.request);
      assert.equal((await req('POST', '/privacy/requests', parent, { request_type: 'access', subject_id: child })).status, 403);
      assert.equal((await req('POST', `/privacy/requests/${parent.request}/export`, parent)).status, 403);
      assert.deepEqual(await stateInDb(parent.request), before);
      assert.equal((await req('POST', '/privacy/requests', parent, { request_type: 'rectification' })).status, 201);
    } finally { await db.query('UPDATE guardians SET deleted_at=NULL WHERE id=$1', [parent.guardian]); }
  });
  await check('current link with reduced capabilities keeps minimized rights export, not full medical data', async () => {
    await db.query('UPDATE child_guardians SET can_view_health=false,can_view_journal=false,can_receive_invoices=false WHERE id=$1', [parent.link]);
    try {
      const response = await req('POST', `/privacy/requests/${parent.request}/export`, parent); assert.equal(response.status, 201);
      assert.equal(response.body.payload.health_record, null); assert.deepEqual(response.body.payload.journal_events, []); assert.deepEqual(response.body.payload.invoices, []);
    } finally { await db.query('UPDATE child_guardians SET can_view_health=true,can_view_journal=true,can_receive_invoices=true WHERE id=$1', [parent.link]); }
  });
  for (const [name, user] of [['peer', peer], ['foreign', foreign], ['accountant', accountant]]) {
    for (const [method, path] of [['GET', `/privacy/requests/${parent.request}`], ['POST', `/privacy/requests/${parent.request}/export`]]) await check(`${name}: other request remains forbidden`, async () => {
      const before = await stateInDb(parent.request); assert.equal((await req(method, path, user)).status, 404); assert.deepEqual(await stateInDb(parent.request), before);
    });
  }
  await check('unlinked active peer can submit personal request, not a child request', async () => {
    assert.equal((await req('POST', '/privacy/requests', peer, { request_type: 'rectification' })).status, 201);
    assert.equal((await req('POST', '/privacy/requests', peer, { request_type: 'access', subject_id: child })).status, 403);
  });
  await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [org, parent.id]);
  try {
    await check('active director can read and export an inactive requester case', async () => {
      const detail = await req('GET', `/privacy/requests/${parent.request}`, director); assert.equal(detail.status, 200); assert.equal(detail.body.requester_id, parent.id);
      const response = await req('POST', `/privacy/requests/${parent.request}/export`, director); assert.equal(response.status, 201);
      assert.equal(response.body.payload.health_record.general_notes, 'H2F_MEDICAL_SECRET');
    });
    await check('active operator can resolve an inactive requester case', async () => {
      await db.query("UPDATE privacy_requests SET status='pending',resolved_at=NULL,resolved_by=NULL WHERE id=$1", [parent.request]);
      const response = await req('POST', `/privacy/requests/${parent.request}/resolve`, operator); assert.equal(response.status, 201);
      const row = await stateInDb(parent.request); assert.equal(row.status, 'resolved'); assert.equal(row.resolved_by, operator.id);
    });
  } finally { await db.query('UPDATE memberships SET is_active=true WHERE organization_id=$1 AND user_id=$2', [org, parent.id]); }
  await check('prior authorized snapshot and source medical record remain intact', async () => {
    assert.deepEqual((await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1', [snapshot.body.export_id])).rows[0].payload, snapshot.body.payload);
    assert.equal((await db.query('SELECT general_notes FROM health_records WHERE child_id=$1', [child])).rows[0].general_notes, 'H2F_MEDICAL_SECRET');
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`H2f privacy actor: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
