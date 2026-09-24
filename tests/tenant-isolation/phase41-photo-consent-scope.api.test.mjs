#!/usr/bin/env node
// H2g: actual HTTP publication/consents and local URL signing. Fresh *_test, no reset.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

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
  const password = 'Synthetic-H2g-only!', hash = await bcrypt.hash(password, 4);
  const makeOrg = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2g','31') RETURNING id", [randomUUID()])).rows[0].id;
  const org = await makeOrg(), other = await makeOrg();
  const actor = async (role, tenant = org) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2g','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), parent = await actor('parent_primary'), second = await actor('parent_primary'), peer = await actor('parent_primary'), foreign = await actor('parent_primary', other);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2g') RETURNING id", [org])).rows[0].id;
  const makeChild = async () => (await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'Child','H2g','2024-01-01',$3) RETURNING id", [org, site, director.id])).rows[0].id;
  const child = await makeChild(), coChild = await makeChild();
  for (const [user, id] of [[parent, child], [second, coChild]]) {
    const guardian = (await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'H2g','Synthetic','parent',$3) RETURNING id", [org, user.id, director.id])).rows[0].id;
    user.link = (await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal) VALUES($1,$2,$3,true) RETURNING id', [org, id, guardian])).rows[0].id;
  }
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '',
    S3_ENDPOINT: 'http://127.0.0.1:9', S3_ACCESS_KEY: 'h2g-synthetic', S3_SECRET_KEY: 'h2g-synthetic-no-provider' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  };
  for (const user of [director, parent, second, peer, foreign]) {
    const response = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(response.status, 200); user.token = response.body.access_token; assert.ok(user.token);
  }
  const consent = async (user, id, granted) => {
    const response = await req('POST', '/parent/consents', user, { child_id: id, consent_type: 'photo_individual', granted });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  };
  const register = async (participants, primary = child) => {
    const response = await req('POST', '/media', director, { storage_key: `${org}/photo/${randomUUID()}.jpg`, mime_type: 'image/jpeg', child_id: primary, children_in_photo: participants });
    assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.id;
  };
  const publish = (id, visible = true) => req('PATCH', `/media/${id}/visibility`, director, { is_visible_to_parents: visible });
  const countAccess = async id => Number((await db.query('SELECT count(*) n FROM media_access_logs WHERE media_id=$1', [id])).rows[0].n);
  const cases = [
    { name: 'single authorized', participants: [child], a: true, b: true, allowed: true },
    { name: 'group authorized', participants: [child, coChild], a: true, b: true, allowed: true },
    { name: 'primary omitted but consented', participants: [coChild], a: true, b: true, allowed: true },
    { name: 'primary omitted and refused', participants: [coChild], a: false, b: true, allowed: false },
    { name: 'co-child refused', participants: [child, coChild], a: true, b: false, allowed: false },
    { name: 'duplicate participants authorized', participants: [child, child], a: true, b: true, allowed: true },
    { name: 'declaration absent', participants: null, a: true, b: true, allowed: false },
    { name: 'declaration empty', participants: [], a: true, b: true, allowed: false },
    { name: 'legacy checked null declaration', participants: null, checked: true, a: true, b: true, allowed: false },
    { name: 'legacy checked empty declaration', participants: [], checked: true, a: true, b: true, allowed: false },
    { name: 'legacy unchecked visible', participants: [child], checked: false, a: true, b: true, allowed: false },
    { name: 'co-child deleted after registration', participants: [child, coChild], deleted: true, a: true, b: true, allowed: false },
  ];
  for (const item of cases) {
    await consent(parent, child, item.a); await consent(second, coChild, item.b);
    const id = await register(item.participants);
    if (item.checked !== undefined) await db.query('UPDATE media_assets SET all_consents_checked=$1 WHERE id=$2', [item.checked, id]); // inconsistent historical metadata
    if (item.deleted) await db.query('UPDATE children SET deleted_at=NOW() WHERE id=$1', [coChild]);
    try {
      await check(`${item.name}: publication`, async () => {
        const response = await publish(id); assert.equal(response.status, item.allowed ? 200 : 422, JSON.stringify(response.body));
        assert.equal((await db.query('SELECT is_visible_to_parents FROM media_assets WHERE id=$1', [id])).rows[0].is_visible_to_parents, item.allowed);
      });
      // Independent historical-read proof: a previous version may already have published it.
      await db.query('UPDATE media_assets SET is_visible_to_parents=true WHERE id=$1', [id]);
      await check(`${item.name}: direct parent URL and access log`, async () => {
        const before = await countAccess(id);
        const response = await req('GET', `/parent/children/${child}/media/${id}/download`, parent);
        assert.equal(response.status, item.allowed ? 200 : 422, JSON.stringify(response.body));
        // LOT 2 (P0 F5) : chemin same-origin exact (plus d'URL signée S3).
        if (item.allowed) assert.equal(response.body.url, `/api/v1/parent/children/${child}/media/${id}/content`); else assert.equal(response.body.url, undefined);
        assert.equal(await countAccess(id), before + (item.allowed ? 1 : 0));
      });
      await check(`${item.name}: parent list`, async () => {
        const before = await countAccess(id), response = await req('GET', `/parent/children/${child}/media`, parent);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.some(row => row.id === id), item.allowed);
        if (item.allowed) assert.equal(response.body.find(row => row.id === id).url, `/api/v1/parent/children/${child}/media/${id}/content`);
        assert.equal(await countAccess(id), before + (item.allowed ? 1 : 0));
      });
      await check(`${item.name}: withdrawal always possible, metadata retained`, async () => {
        const response = await publish(id, false); assert.equal(response.status, 200);
        const row = (await db.query('SELECT is_visible_to_parents,children_in_photo FROM media_assets WHERE id=$1', [id])).rows[0];
        assert.equal(row.is_visible_to_parents, false); assert.deepEqual(row.children_in_photo, item.participants);
      });
    } finally { await db.query('UPDATE children SET deleted_at=NULL WHERE id=$1', [coChild]); await publish(id, false); }
  }
  await consent(parent, child, true); await consent(second, coChild, true);
  const late = await register([coChild]); assert.equal((await publish(late)).status, 200);
  await consent(parent, child, false);
  await check('primary consent revoked via HTTP after publication denies new URL', async () => {
    const before = await countAccess(late), response = await req('GET', `/parent/children/${child}/media/${late}/download`, parent);
    assert.equal(response.status, 422); assert.equal(response.body.url, undefined); assert.equal(await countAccess(late), before);
  });
  await check('primary consent revoked after publication removes image from parent list', async () => {
    const response = await req('GET', `/parent/children/${child}/media`, parent); assert.equal(response.status, 200); assert.ok(!response.body.some(row => row.id === late));
  });
  await consent(parent, child, true);
  await check('restoring primary consent restores legitimate parent access', async () => {
    const response = await req('GET', `/parent/children/${child}/media/${late}/download`, parent); assert.equal(response.status, 200); assert.equal(response.body.url, `/api/v1/parent/children/${child}/media/${late}/content`);
  });
  for (const [name, user] of [['peer', peer], ['foreign', foreign]]) await check(`${name} cannot get another child URL`, async () => {
    assert.ok([403, 404].includes((await req('GET', `/parent/children/${child}/media/${late}/download`, user)).status));
  });
  await check('journal revocation remains effective independently of photo consent', async () => {
    await db.query('UPDATE child_guardians SET can_view_journal=false WHERE id=$1', [parent.link]);
    try { assert.equal((await req('GET', `/parent/children/${child}/media/${late}/download`, parent)).status, 403); }
    finally { await db.query('UPDATE child_guardians SET can_view_journal=true WHERE id=$1', [parent.link]); }
  });
  await check('parent cannot bypass via staff download', async () => { assert.equal((await req('GET', `/media/${late}/download`, parent)).status, 403); });
  await check('authorized staff retain download even when parent consent is revoked', async () => {
    await consent(parent, child, false);
    const response = await req('GET', `/media/${late}/download`, director); assert.equal(response.status, 200); assert.equal(response.body.url, `/api/v1/media/${late}/content`);
  });
  await check('missing primary consent cannot be hidden by consented group-only registration', async () => {
    const response = await publish(late); assert.equal(response.status, 422);
  });
  await check('unrelated historical assets and consent records are not purged', async () => {
    assert.equal(Number((await db.query('SELECT count(*) n FROM media_assets WHERE organization_id=$1', [org])).rows[0].n), cases.length + 1);
    assert.ok(Number((await db.query('SELECT count(*) n FROM consent_records WHERE organization_id=$1', [org])).rows[0].n) >= 24);
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`H2g photo consent: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
