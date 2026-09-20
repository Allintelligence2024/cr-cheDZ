#!/usr/bin/env node
// Phase 5 (rapport 5 analyses) — C3 : endpoint POST /privacy/children/:id/anonymize
// (directeur/super_admin uniquement), branché sur anonymize_child (067).
// Prouve : refus par rôle (éducateur, comptable, parent : 403 sans écrit),
// tenant étranger 404, enfant actif 409, motif court 400, succès 201 avec
// résultat structuré + clôture de la demande de droits + purge S3 HONNÊTE
// (aucun MinIO ici → échec remonté dans media_purge.failed, jamais un faux
// « purgé »), rejeu idempotent.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let app, pool, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
try {
  await ensureAppRole(db);
  const password = 'Synthetic-P56-only!', hash = await bcrypt.hash(password, 4);
  const org = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P56b','31') RETURNING id", [randomUUID()])).rows[0].id;
  const a = await org(), b = await org();
  const actor = async (role, tenant = a) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P56b','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), foreign = await actor('director', b);
  const educator = await actor('educator'), accountant = await actor('accountant'), parent = await actor('parent_primary');
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'P56b') RETURNING id", [a])).rows[0].id;
  const child = async (status) => (await db.query(
    `INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,status,departure_date,created_by)
     VALUES($1,$2,'Canari','P56b','2021-01-10',$3,$4,$5) RETURNING id`,
    [a, site, status, status === 'departed' ? '2026-08-31' : null, director.id])).rows[0].id;
  const departed = await child('departed'), active = await child('active');
  await db.query(`INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type) VALUES($1,$2,$3,'photo',$4,'image/jpeg')`,
    [a, departed, director.id, `${a}/photo/p56b-${randomUUID().slice(0, 8)}.jpg`]);
  const request = (await db.query(
    `INSERT INTO privacy_requests(organization_id,requester_id,request_type,subject_id,deadline) VALUES($1,$2,'opposition',$3,NOW()+interval '30 days') RETURNING id`,
    [a, director.id, departed])).rows[0].id;

  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', SENTRY_DSN: '', S3_ENDPOINT: 'http://127.0.0.1:9' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return { status: r.status, body: await r.json() };
  };
  for (const u of [director, foreign, educator, accountant, parent]) {
    const r = await req('POST', '/auth/login', null, { email: u.email, password });
    assert.equal(r.status, 200, JSON.stringify(r.body)); u.token = r.body.access_token; assert.ok(u.token);
  }
  const anonymize = (u, id, body = { reason: 'Demande d’effacement 25-11 du tuteur' }) => req('POST', `/privacy/children/${id}/anonymize`, u, body);
  const name = async (id) => (await db.query('SELECT first_name_fr FROM children WHERE id=$1', [id])).rows[0].first_name_fr;

  await check('non authentifié → 401', async () => { const r = await anonymize(null, departed); assert.equal(r.status, 401); });
  for (const [label, u] of [['éducateur', educator], ['comptable', accountant], ['parent', parent]]) {
    await check(`${label} → 403, aucun écrit`, async () => {
      const r = await anonymize(u, departed);
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(await name(departed), 'Canari');
    });
  }
  await check('directeur d’un AUTRE tenant → 404 (pas d’oracle), aucun écrit', async () => {
    const r = await anonymize(foreign, departed);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(await name(departed), 'Canari');
  });
  await check('enfant encore actif → 409 CHILD_STILL_ACTIVE', async () => {
    const r = await anonymize(director, active);
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'CHILD_STILL_ACTIVE');
    assert.equal(await name(active), 'Canari');
  });
  await check('motif trop court → 400 ANONYMIZE_REASON_REQUIRED', async () => {
    const r = await anonymize(director, departed, { reason: 'ok' });
    assert.equal(r.status, 400, JSON.stringify(r.body)); assert.equal(r.body.code, 'ANONYMIZE_REASON_REQUIRED');
    assert.equal(await name(departed), 'Canari');
  });
  await check('id non UUID → 400 (validation)', async () => { const r = await anonymize(director, 'nope'); assert.equal(r.status, 400); });

  let first;
  await check('directeur → 201 : enfant anonymisé, demande de droits clôturée, purge S3 HONNÊTE (échec remonté, pas de faux « purgé »)', async () => {
    first = await anonymize(director, departed, { reason: 'Demande d’effacement 25-11 du tuteur', request_id: request });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.already_anonymized, false);
    assert.match(await name(departed), /^Anonyme-[0-9a-f]{8}$/);
    assert.equal(first.body.media_storage_keys.length, 1);
    assert.equal(first.body.media_purge.purged, 0, 'aucun MinIO joignable : rien ne doit être déclaré purgé');
    assert.equal(first.body.media_purge.failed.length, 1);
    assert.equal(first.body.media_purge.failed[0].key, first.body.media_storage_keys[0]);
    const pr = (await db.query('SELECT status, resolved_by FROM privacy_requests WHERE id=$1', [request])).rows[0];
    assert.equal(pr.status, 'resolved'); assert.equal(pr.resolved_by, director.id);
    const purgeAudit = (await db.query("SELECT new_values FROM audit_logs WHERE resource_type='media_purge' AND resource_id=$1", [departed])).rows;
    assert.equal(purgeAudit.length, 1); assert.equal(purgeAudit[0].new_values.purged, 0); assert.equal(purgeAudit[0].new_values.failed.length, 1);
  });
  await check('rejeu → 201 already_anonymized=true, pas de nouvelle purge ni audit', async () => {
    const r = await anonymize(director, departed);
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.already_anonymized, true);
    assert.equal(r.body.media_purge.purged, 0); assert.equal(r.body.media_purge.failed.length, 0);
    const n = (await db.query("SELECT count(*)::int n FROM audit_logs WHERE resource_type IN ('media_purge','child') AND resource_id=$1 AND action='delete'", [departed])).rows[0].n;
    assert.equal(n, 2, 'exactement 1 audit child + 1 audit media_purge');
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end();
}
console.log(`Phase 56b anonymize endpoint: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
