#!/usr/bin/env node
// H2e: real API HTTP + PostgreSQL, synthetic records; fresh *_test required, no reset here.
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
  const password = 'Synthetic-H2e-only!', hash = await bcrypt.hash(password, 4);
  const makeOrg = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2e','31') RETURNING id", [randomUUID()])).rows[0].id;
  const org = await makeOrg(), other = await makeOrg();
  const actor = async (role, tenant = org) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2e','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), full = await actor('parent_primary'), limited = await actor('parent_primary'), healthOnly = await actor('parent_primary'), peer = await actor('parent_primary'), foreign = await actor('parent_primary', other);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2e') RETURNING id", [org])).rows[0].id;
  const child = (await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'Child','H2e','2024-01-01',$3) RETURNING id", [org, site, director.id])).rows[0].id;
  const link = async (user, journal, health) => {
    const guardian = (await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'H2e','Synthetic','parent',$3) RETURNING id", [org, user.id, director.id])).rows[0].id;
    user.link = (await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health,can_receive_push) VALUES($1,$2,$3,$4,$5,false) RETURNING id', [org, child, guardian, journal, health])).rows[0].id;
  };
  await link(full, true, true); await link(limited, true, false); await link(healthOnly, false, true);
  await db.query("INSERT INTO health_records(organization_id,child_id,blood_type) VALUES($1,$2,'O+')", [org, child]);
  await db.query("INSERT INTO allergies(organization_id,child_id,allergen,allergen_type,severity,created_by) VALUES($1,$2,'H2E_ALLERGY','food','mild',$3)", [org, child, director.id]);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  };
  for (const user of [director, full, limited, healthOnly, peer, foreign]) {
    const response = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(response.status, 200); user.token = response.body.access_token; assert.ok(user.token);
  }
  const event = async (body) => {
    const response = await req('POST', '/journal/events', director, { child_id: child, occurred_at: '2026-09-14T08:00:00Z', ...body });
    assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.id;
  };
  const meal = await event({ event_type: 'meal', meal_quantity: 'all' });
  const incident = await event({ event_type: 'incident', incident_severity: 'minor', incident_description: 'PUBLIC_PLAYGROUND_INCIDENT' });
  const mixed = await event({ event_type: 'activity', activity_name: 'PUBLIC_ACTIVITY', temperature_celsius: 38, health_observation: 'MEDICAL_MIXED_VALUE' });
  const temperature = await event({ event_type: 'temperature', temperature_celsius: 38.5, activity_notes: 'MEDICAL_TEMP_SIDE', note_text: 'MEDICAL_TEMP_NOTE' });
  const observation = await event({ event_type: 'health_observation', health_observation: 'MEDICAL_OBSERVATION_VALUE', incident_description: 'MEDICAL_OBS_SIDE' });
  const hidden = await event({ event_type: 'temperature', visible_to_parents: false, activity_notes: 'HIDDEN_HEALTH' });
  const privateId = await event({ event_type: 'health_observation', note_is_private: true, activity_notes: 'PRIVATE_HEALTH' });
  const feed = async (user) => {
    const response = await req('GET', `/parent/children/${child}/feed`, user); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
  };
  for (const user of [full, limited, healthOnly]) {
    const response = await req('POST', '/privacy/requests', user, { request_type: 'access', subject_id: child });
    assert.equal(response.status, 201); user.request = response.body.id;
  }
  const exported = async (user, request = user.request) => {
    const response = await req('POST', `/privacy/requests/${request}/export`, user); assert.equal(response.status, 201, JSON.stringify(response.body));
    const stored = (await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1', [response.body.export_id])).rows[0].payload;
    assert.deepEqual(stored, response.body.payload, 'persisted export must match HTTP projection');
    return response.body;
  };
  const limitedFeed = await feed(limited), fullFeed = await feed(full);
  await check('journal-only feed hides temperature identity/type/time', async () => { assert.ok(!limitedFeed.some(row => row.id === temperature || row.event_type === 'temperature')); });
  await check('journal-only feed hides health observation identity/type/time', async () => { assert.ok(!limitedFeed.some(row => row.id === observation || row.event_type === 'health_observation')); });
  await check('journal-only feed excludes medical-event side fields accepted by the HTTP DTO', async () => { assert.ok(!JSON.stringify(limitedFeed).includes('MEDICAL_')); });
  await check('journal-only feed keeps meals, activities and incidents', async () => { for (const id of [meal, mixed, incident]) assert.ok(limitedFeed.some(row => row.id === id)); });
  await check('feed already excludes raw temperature/observation columns, even for mixed events', async () => {
    for (const rows of [limitedFeed, fullFeed]) for (const row of rows) { assert.equal(row.temperature_celsius, undefined); assert.equal(row.health_observation, undefined); }
  });
  await check('journal+health feed retains visible medical metadata and its existing projection', async () => {
    assert.ok(fullFeed.some(row => row.id === temperature)); assert.ok(fullFeed.some(row => row.id === observation));
    assert.ok(JSON.stringify(fullFeed).includes('MEDICAL_TEMP_SIDE')); assert.ok(JSON.stringify(fullFeed).includes('MEDICAL_OBS_SIDE'));
  });
  for (const [name, rows] of [['limited', limitedFeed], ['full', fullFeed]]) await check(`${name} feed already hides private and invisible events`, async () => {
    assert.ok(!rows.some(row => [hidden, privateId].includes(row.id))); assert.ok(!JSON.stringify(rows).includes('HIDDEN_HEALTH')); assert.ok(!JSON.stringify(rows).includes('PRIVATE_HEALTH'));
  });
  await check('health permission alone does not grant the journal', async () => { assert.equal((await req('GET', `/parent/children/${child}/feed`, healthOnly)).status, 403); });
  await check('health-only parent still reads the separate health endpoint', async () => {
    const response = await req('GET', `/parent/children/${child}/health`, healthOnly); assert.equal(response.status, 200); assert.equal(response.body.allergies[0].allergen, 'H2E_ALLERGY');
  });
  await check('journal-only parent is already denied the health endpoint', async () => { assert.equal((await req('GET', `/parent/children/${child}/health`, limited)).status, 403); });
  await check('staff raw journal keeps clinical values and internal events', async () => {
    const response = await req('GET', `/journal/events?child_id=${child}`, director); assert.equal(response.status, 200);
    const rows = response.body.items; assert.ok(rows.some(row => row.id === hidden)); assert.ok(rows.some(row => row.id === privateId));
    assert.equal(Number(rows.find(row => row.id === temperature).temperature_celsius), 38.5);
    assert.equal(rows.find(row => row.id === observation).health_observation, 'MEDICAL_OBSERVATION_VALUE');
  });
  for (const path of ['/journal/events', '/journal/feed']) await check(`parent cannot bypass via staff ${path}`, async () => { assert.equal((await req('GET', `${path}?child_id=${child}`, limited)).status, 403); });
  const limitedExport = await exported(limited), fullExport = await exported(full), operatorExport = await exported(director, full.request);
  await check('journal-only rights export excludes temperature events, HTTP and stored JSON', async () => { assert.ok(!limitedExport.payload.journal_events.some(row => row.event_type === 'temperature')); });
  await check('journal-only rights export already excludes health_observation events', async () => { assert.ok(!limitedExport.payload.journal_events.some(row => row.event_type === 'health_observation')); });
  await check('journal-only rights export excludes medical-event side fields', async () => { assert.ok(!JSON.stringify(limitedExport.payload.journal_events).includes('MEDICAL_')); });
  await check('mixed nonmedical event keeps public activity but already masks medical columns in rights export', async () => {
    const row = limitedExport.payload.journal_events.find(row => row.activity_name === 'PUBLIC_ACTIVITY'); assert.ok(row);
    assert.equal(row.temperature_celsius, null); assert.equal(row.health_observation, null);
  });
  for (const [name, result] of [['parent', fullExport], ['operator', operatorExport]]) await check(`${name} authorized export retains temperature and observation values`, async () => {
    const rows = result.payload.journal_events;
    assert.equal(Number(rows.find(row => row.event_type === 'temperature').temperature_celsius), 38.5);
    assert.equal(rows.find(row => row.event_type === 'health_observation').health_observation, 'MEDICAL_OBSERVATION_VALUE');
  });
  for (const [name, result] of [['limited', limitedExport], ['full', fullExport], ['operator', operatorExport]]) await check(`${name} export already excludes hidden/private events`, async () => {
    assert.ok(!JSON.stringify(result.payload.journal_events).includes('HIDDEN_HEALTH')); assert.ok(!JSON.stringify(result.payload.journal_events).includes('PRIVATE_HEALTH'));
  });
  await check('health-only rights export keeps health data, not journal', async () => {
    const result = await exported(healthOnly); assert.deepEqual(result.payload.journal_events, []); assert.equal(result.payload.health_record.blood_type, 'O+');
  });
  await db.query('UPDATE child_guardians SET can_view_health=false WHERE id=$1', [full.link]);
  try {
    await check('health revoked before next HTTP call: feed hides both medical types without losing meals', async () => {
      const rows = await feed(full); assert.ok(rows.some(row => row.id === meal)); assert.ok(!rows.some(row => ['temperature', 'health_observation'].includes(row.event_type)));
    });
    await check('health revoked before export: new HTTP/stored projection hides both medical types', async () => {
      const result = await exported(full); assert.ok(!result.payload.journal_events.some(row => ['temperature', 'health_observation'].includes(row.event_type)));
      assert.equal(result.payload.health_record, null);
    });
  } finally { await db.query('UPDATE child_guardians SET can_view_health=true WHERE id=$1', [full.link]); }
  await check('restoring health permission restores authorized feed and export', async () => {
    assert.ok((await feed(full)).some(row => row.id === temperature)); assert.ok((await exported(full)).payload.journal_events.some(row => row.event_type === 'temperature'));
  });
  await db.query('UPDATE child_guardians SET can_view_journal=false WHERE id=$1', [full.link]);
  try {
    await check('journal revoked still denies feed independently of health', async () => { assert.equal((await req('GET', `/parent/children/${child}/feed`, full)).status, 403); });
    await check('journal revoked yields empty journal in rights export, health retained', async () => { const result = await exported(full); assert.deepEqual(result.payload.journal_events, []); assert.equal(result.payload.health_record.blood_type, 'O+'); });
  } finally { await db.query('UPDATE child_guardians SET can_view_journal=true WHERE id=$1', [full.link]); }
  for (const [name, user] of [['peer', peer], ['foreign', foreign]]) {
    await check(`${name} cannot read child feed`, async () => { assert.ok([403, 404].includes((await req('GET', `/parent/children/${child}/feed`, user)).status)); });
    await check(`${name} cannot export another requester dossier`, async () => { assert.equal((await req('POST', `/privacy/requests/${full.request}/export`, user)).status, 404); });
  }
  // Real HTTP publication of 101 newer medical events: filter before, never after LIMIT 100.
  for (let i = 0; i < 101; i++) await event({ event_type: i % 2 ? 'temperature' : 'health_observation', occurred_at: '2026-09-14T12:00:00Z' });
  await check('medical filtering precedes LIMIT 100, so older authorized meals remain reachable', async () => {
    const rows = await feed(limited); assert.ok(rows.some(row => row.id === meal)); assert.ok(!rows.some(row => ['temperature', 'health_observation'].includes(row.event_type)));
  });
  await check('fully authorized feed keeps its 100-row limit', async () => { assert.equal((await feed(full)).length, 100); });
  await check('source medical events and earlier authorized export snapshot are not purged or rewritten', async () => {
    const rows = (await db.query('SELECT id,temperature_celsius,health_observation FROM daily_log_events WHERE id=ANY($1::uuid[])', [[temperature, observation]])).rows;
    assert.equal(Number(rows.find(row => row.id === temperature).temperature_celsius), 38.5);
    assert.equal(rows.find(row => row.id === observation).health_observation, 'MEDICAL_OBSERVATION_VALUE');
    assert.deepEqual((await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1', [fullExport.export_id])).rows[0].payload, fullExport.payload);
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`H2e journal health: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
