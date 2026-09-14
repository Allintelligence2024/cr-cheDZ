#!/usr/bin/env node
/** F3b: child producers and tenant-safe minimal projections, real HTTP/PG.
 * No reset here. F4 (real Dart -> API) and concurrent commit-order remain open.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';
import { assertSchema } from '../contracts/schema-validator.mjs';

const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: adminUrl }); await db.connect();
let app, pool, scoped;
let passed = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}: ${error.stack}`); }
}
const liveKeys = ['id', 'organization_id', 'site_id', 'room_id', 'first_name_fr', 'first_name_ar', 'last_name_fr', 'last_name_ar', 'date_of_birth', 'photo_url', 'status', 'is_walking', 'version'].sort();
const deletedKeys = ['id', 'organization_id', 'version', 'deleted_at'].sort();
try {
  await ensureAppRole(db);
  const suffix = randomUUID();
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya,max_children) VALUES($1,'F3b Test','31',1000) RETURNING id", [`f3b-${suffix}`])).rows[0].id;
  const email = `f3b-${suffix}@test.dz`;
  const user = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F3b','Test',$2,'active') RETURNING id", [email, await bcrypt.hash('Password123!', 4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, user]);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F3b Site') RETURNING id", [org])).rows[0].id;
  const rooms = (await db.query("INSERT INTO rooms(organization_id,site_id,name_fr) VALUES($1,$2,'Room A'),($1,$2,'Room B') RETURNING id", [org, site])).rows.map(r => r.id);
  const applicationUrl = appUrl();
  scoped = new pg.Client({ connectionString: applicationUrl }); await scoped.connect();
  async function tenant(fn) {
    await scoped.query('BEGIN');
    try {
      await scoped.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [org, user]);
      const result = await fn(scoped); await scoped.query('COMMIT'); return result;
    } catch (error) { await scoped.query('ROLLBACK'); throw error; }
  }
  process.env.DATABASE_URL = applicationUrl;
  process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  async function req(method, path, body) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const response = r.status === 204 ? {} : await r.json();
    if (r.status >= 400) assertSchema('ErrorResponse', response);
    else if (path.startsWith('/sync/pull')) assertSchema('PullResponse', response);
    return { status: r.status, body: response };
  }
  token = (await req('POST', '/auth/login', { email, password: 'Password123!' })).body.access_token;
  assert.ok(token);
  const register = async () => (await req('POST', '/devices', { name: 'F3b device', device_fingerprint: randomUUID(), platform: 'android' })).body.device_id;
  const device = await register(); assert.ok(device);
  const pull = async (cursor = '0', dev = device) => {
    const r = await req('GET', `/sync/pull?cursor=${cursor}&device_id=${dev}`);
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
  };
  async function create(extra = {}) {
    const r = await req('POST', '/children', { site_id: site, room_id: rooms[0], first_name_fr: 'Synthetic', last_name_fr: 'F3b', date_of_birth: '2024-02-29', notes: 'PRIVATE-NOTE-NOT-FOR-SYNC', special_needs_notes: 'PRIVATE-HEALTH', ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
  }
  async function events(id) {
    const rows = (await db.query('SELECT sync_seq::text,aggregate_type AS type,aggregate_id,event_type,payload FROM sync_changelog WHERE organization_id=$1 AND aggregate_id=$2 ORDER BY sync_changelog.sync_seq', [org, id])).rows;
    rows.forEach(e => { assert.equal(e.type, 'child'); assert.equal(e.payload.id, id); assert.equal(e.payload.organization_id, org); });
    return rows;
  }
  function minimal(e, deleted = false) {
    assert.ok(e, 'child event missing');
    assert.deepEqual(Object.keys(e.payload).sort(), deleted ? deletedKeys : liveKeys);
    assert.ok(Number.isInteger(e.payload.version) && e.payload.version > 0);
    if (!deleted) assert.match(e.payload.date_of_birth, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(JSON.stringify(e).includes('PRIVATE-'), false);
  }
  const child = await create();
  await check('HTTP create produces one minimal child event readable by a second device', async () => {
    const list = await events(child); assert.equal(list.length, 1); minimal(list[0]);
    assert.equal(list[0].event_type, 'created'); assert.equal(list[0].payload.date_of_birth, '2024-02-29');
    const page = await pull('0', await register());
    assert.deepEqual(page.events.filter(e => e.type === 'child').map(e => e.aggregate_id), [child]);
  });
  await check('PATCH emits changed fields/status without family/medical/private fields', async () => {
    const r = await req('PATCH', `/children/${child}`, { first_name_fr: 'Changed', status: 'departed', is_walking: true, notes: 'PRIVATE-CHANGED', room_id: rooms[1] });
    assert.equal(r.status, 200);
    const list = await events(child); assert.equal(list.length, 2); const e = list.at(-1); minimal(e);
    assert.equal(e.event_type, 'updated'); assert.equal(e.payload.first_name_fr, 'Changed');
    assert.equal(e.payload.status, 'departed'); assert.equal(e.payload.room_id, rooms[1]); assert.equal(e.payload.is_walking, true);
    assert.equal(e.payload.version, r.body.version);
  });
  await check('move-room endpoint emits one update; repeat/no-op emits none', async () => {
    const id = await create();
    assert.equal((await req('POST', `/children/${id}/move-room`, { room_id: rooms[1] })).status, 201);
    const list = await events(id); assert.equal(list.length, 2); minimal(list.at(-1));
    assert.equal(list.at(-1).payload.room_id, rooms[1]);
    await req('POST', `/children/${id}/move-room`, { room_id: rooms[1] });
    assert.deepEqual(await events(id), list);
  });
  await check('import emits one child per valid row, dry-run emits none', async () => {
    const rows = [1, 2].map(n => ({ first_name_fr: `Import ${n}`, last_name_fr: 'Synthetic', date_of_birth: '2024-01-01', notes: 'PRIVATE-IMPORT' }));
    const before = (await pull()).events.length;
    const dry = await req('POST', '/children/import', { rows, dry_run: true }); assert.equal(dry.status, 201); assert.equal(dry.body.inserted, 0);
    assert.equal((await pull()).events.length, before);
    const imported = await req('POST', '/children/import', { rows }); assert.equal(imported.status, 201); assert.equal(imported.body.inserted, 2);
    const page = await pull(); const added = page.events.slice(before); assert.equal(added.length, 2);
    added.forEach(e => { minimal(e); assert.equal(e.event_type, 'created'); });
  });
  await check('soft delete emits an identity-only tombstone, not a departed full record', async () => {
    const id = await create(); assert.equal((await req('DELETE', `/children/${id}`)).status, 204);
    const list = await events(id); assert.equal(list.length, 2); const e = list.at(-1); minimal(e, true);
    assert.equal(e.event_type, 'deleted'); assert.ok(Number.isFinite(Date.parse(e.payload.deleted_at)));
    assert.equal(e.payload.version, 2);
  });
  await check('direct tenant SQL writes also emit; physical delete is a tombstone', async () => {
    const id = await tenant(async c => (await c.query("INSERT INTO children(organization_id,site_id,created_by,first_name_fr,last_name_fr,date_of_birth) VALUES($1,$2,$3,'Direct','Synthetic','2024-01-01') RETURNING id", [org, site, user])).rows[0].id);
    await tenant(c => c.query('UPDATE children SET photo_url=$2,version=version+1 WHERE id=$1', [id, `${org}/synthetic.jpg`]));
    let list = await events(id); assert.equal(list.length, 2); minimal(list.at(-1)); assert.equal(list.at(-1).payload.photo_url, `${org}/synthetic.jpg`);
    await tenant(c => c.query('DELETE FROM children WHERE id=$1', [id]));
    list = await events(id); assert.equal(list.length, 3); minimal(list.at(-1), true); assert.equal(list.at(-1).payload.version, 3);
  });
  await check('transaction rollback leaves neither child nor changelog', async () => {
    const id = randomUUID();
    await assert.rejects(tenant(async c => {
      await c.query("INSERT INTO children(id,organization_id,site_id,created_by,first_name_fr,last_name_fr,date_of_birth) VALUES($1,$2,$3,$4,'Rolled','Back','2024-01-01')", [id, org, site, user]);
      throw new Error('synthetic rollback');
    }), /synthetic rollback/);
    assert.equal((await db.query('SELECT id FROM children WHERE id=$1', [id])).rowCount, 0);
    assert.deepEqual(await events(id), []);
  });
  await check('timestamp-only update emits no redundant snapshot', async () => {
    const id = await create(); const before = await events(id);
    await tenant(c => c.query('UPDATE children SET updated_at=clock_timestamp() WHERE id=$1', [id]));
    assert.deepEqual(await events(id), before);
  });
  await check('another tenant child never appears in pull or accepts a scoped update', async () => {
    const other = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'Other','31') RETURNING id", [`f3b-other-${suffix}`])).rows[0].id;
    const otherSite = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'Other') RETURNING id", [other])).rows[0].id;
    const id = (await db.query("INSERT INTO children(organization_id,site_id,created_by,first_name_fr,last_name_fr,date_of_birth) VALUES($1,$2,$3,'Other','Synthetic','2024-01-01') RETURNING id", [other, otherSite, user])).rows[0].id;
    assert.equal((await req('PATCH', `/children/${id}`, { first_name_fr: 'Forbidden' })).status, 404);
    const page = await pull(); assert.ok(page.events.every(e => e.payload.organization_id === org));
    assert.ok(!page.events.some(e => e.aggregate_id === id));
  });
  await check('501 static child projections paginate without duplicates and replay stays empty', async () => {
    const cursor = (await pull()).next_cursor;
    const ids = await tenant(async c => (await c.query("INSERT INTO children(organization_id,site_id,created_by,first_name_fr,last_name_fr,date_of_birth) SELECT $1,$2,$3,'Bulk '||n,'Synthetic','2024-01-01' FROM generate_series(1,501) AS n RETURNING id", [org, site, user])).rows.map(r => r.id));
    const first = await pull(cursor); assert.equal(first.events.length, 500);
    const second = await pull(first.next_cursor); assert.equal(second.events.length, 1);
    const received = [...first.events, ...second.events]; received.forEach(e => minimal(e));
    assert.deepEqual(new Set(received.map(e => e.aggregate_id)), new Set(ids));
    assert.deepEqual(await pull(second.next_cursor), { events: [], next_cursor: second.next_cursor });
  });
  await check('privileged tenant reassignment invalidates the OLD scope with a minimal tombstone', async () => {
    const id = await create();
    const target = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'Move target','31') RETURNING id", [`f3b-move-${suffix}`])).rows[0].id;
    const targetSite = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'Target') RETURNING id", [target])).rows[0].id;
    await db.query('UPDATE children SET organization_id=$2,site_id=$3,room_id=NULL,version=version+1 WHERE id=$1', [id, target, targetSite]);
    const old = (await events(id)).at(-1); minimal(old, true); assert.equal(old.event_type, 'deleted');
    const moved = (await db.query("SELECT payload FROM sync_changelog WHERE organization_id=$1 AND aggregate_id=$2", [target, id])).rows;
    assert.equal(moved.length, 1); assert.equal(moved[0].payload.organization_id, target);
  });
  await check('migration bootstraps pre-existing live/deleted children; rehearsal fully rolls back', async () => {
    // Replay the ACTUAL migration SQL against pre-059 fixtures, inside one
    // reversible transaction. No migration file/registry is edited or deleted.
    const upgrade = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? adminUrl });
    await upgrade.connect();
    const live = randomUUID(), deleted = randomUUID();
    try {
      await upgrade.query('BEGIN'); await upgrade.query("SET LOCAL lock_timeout='5s'");
      if (process.env.PRODUCTION_ROLE_TESTS === '1') {
        assert.equal((await upgrade.query('SELECT current_user AS role')).rows[0].role, 'creche_migrator');
      }
      await upgrade.query('DROP TRIGGER sync_child_changed ON children');
      await upgrade.query('DROP FUNCTION sync_child_changed(), sync_child_projection(children), sync_child_tombstone(children,timestamptz,bigint)');
      await upgrade.query(`INSERT INTO children(id,organization_id,site_id,created_by,first_name_fr,last_name_fr,date_of_birth,deleted_at,notes)
        VALUES($1,$3,$4,$5,'Legacy','Live','2024-02-29',NULL,'PRIVATE-LEGACY'),
              ($2,$3,$4,$5,'Legacy','Deleted','2024-01-01',NOW(),'PRIVATE-DELETED')`, [live, deleted, org, site, user]);
      assert.equal((await upgrade.query('SELECT 1 FROM sync_changelog WHERE aggregate_id=ANY($1::uuid[])', [[live, deleted]])).rowCount, 0);
      await upgrade.query(readFileSync(new URL('../../infrastructure/database/migrations/059_sync_children.sql', import.meta.url), 'utf8'));
      const rows = (await upgrade.query('SELECT aggregate_id,event_type,payload FROM sync_changelog WHERE aggregate_id=ANY($1::uuid[])', [[live, deleted]])).rows;
      assert.equal(rows.length, 2);
      const snapshot = rows.find(e => e.aggregate_id === live); minimal(snapshot); assert.equal(snapshot.event_type, 'snapshot');
      const tombstone = rows.find(e => e.aggregate_id === deleted); minimal(tombstone, true); assert.equal(tombstone.event_type, 'deleted');
    } finally { await upgrade.query('ROLLBACK'); await upgrade.end(); }
    assert.equal((await db.query('SELECT 1 FROM children WHERE id=ANY($1::uuid[])', [[live, deleted]])).rowCount, 0);
    // DDL rollback must have restored the installed trigger, not disabled sync.
    const id = await create(); assert.equal((await events(id)).length, 1);
  });
  await check('normal migration rerun does not duplicate the bootstrap', async () => {
    const count = async () => (await db.query('SELECT count(*)::text AS n FROM sync_changelog')).rows[0].n;
    const before = await count();
    const output = execFileSync(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: adminUrl }, encoding: 'utf8', timeout: 30000 });
    assert.match(output, /Aucune migration en attente/); assert.equal(await count(), before);
  });

} finally {
  if (app) await app.close(); if (pool) await pool.end(); if (scoped) await scoped.end(); await db.end();
}
console.log(`F3b children: ${passed}/${passed + failures} checks`);
if (failures) process.exitCode = 1;
