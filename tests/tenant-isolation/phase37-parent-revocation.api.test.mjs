#!/usr/bin/env node
// H2c: real HTTP/PostgreSQL. Fresh migrated/seeded *_test required; no reset here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

const url = process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: url });
await db.connect();
const root = await mkdtemp(join(tmpdir(), 'creche-h2c-'));
let app, pool, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}: ${error.stack}`); }
}
try {
  await ensureAppRole(db);
  const password = 'Synthetic-H2c-only!';
  const hash = await bcrypt.hash(password, 4);
  const makeOrg = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2c','31') RETURNING id", [randomUUID()])).rows[0].id;
  const org = await makeOrg(), other = await makeOrg();
  const actor = async (role, tenant = org) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2c','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), parent = await actor('parent_primary'), peer = await actor('parent_primary'), foreign = await actor('parent_primary', other);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2c') RETURNING id", [org])).rows[0].id;
  const child = (await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'H2C_CHILD','Synthetic','2024-01-01',$3) RETURNING id", [org, site, director.id])).rows[0].id;
  const guardian = (await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'H2c','Synthetic','parent',$3) RETURNING id", [org, parent.id, director.id])).rows[0].id;
  const link = (await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health,can_receive_invoices) VALUES($1,$2,$3,true,true,true) RETURNING id', [org, child, guardian])).rows[0].id;
  await db.query("INSERT INTO consent_records(organization_id,guardian_id,child_id,consent_type,granted,granted_at) VALUES($1,$2,$3,'photo_individual',true,NOW())", [org, guardian, child]);
  await db.query("INSERT INTO daily_log_events(organization_id,child_id,event_date,event_type,occurred_at,recorded_by,activity_name,visible_to_parents) VALUES($1,$2,CURRENT_DATE,'activity',NOW(),$3,'H2C_ACTIVITY',true)", [org, child, director.id]);
  await db.query("INSERT INTO allergies(organization_id,child_id,allergen,allergen_type,severity,created_by) VALUES($1,$2,'H2C_ALLERGEN','food','mild',$3)", [org, child, director.id]);
  const media = (await db.query("INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,is_visible_to_parents,children_in_photo,all_consents_checked) VALUES($1,$2,$3,'photo',$4,'image/jpeg',true,ARRAY[$2::uuid],true) RETURNING id", [org, child, director.id, `${org}/photo/h2c.jpg`])).rows[0].id;
  const invoice = (await db.query("INSERT INTO invoices(organization_id,child_id,invoice_number,period_year,period_month,subtotal,total_amount,due_date,created_by) VALUES($1,$2,$3,2026,9,100,100,'2026-09-30',$4) RETURNING id", [org, child, randomUUID(), director.id])).rows[0].id;
  const payment = (await db.query("INSERT INTO payments(organization_id,child_id,reference_number,amount,method,status,created_by,site_id) VALUES($1,$2,$3,100,'cash','confirmed',$4,$5) RETURNING id", [org, child, randomUUID(), director.id, site])).rows[0].id;
  const key = `${org}/invoices/${invoice}.pdf`;
  await mkdir(dirname(join(root, key)), { recursive: true });
  await writeFile(join(root, key), '%PDF-1.4\nH2C_PDF_BYTES\n%%EOF'); // access test, not PDF rendering qualification
  await db.query('UPDATE invoices SET pdf_url=$1 WHERE id=$2', [key, invoice]);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: root,
    S3_ENDPOINT: 'http://127.0.0.1:9', S3_ACCESS_KEY: 'h2c-synthetic', S3_SECRET_KEY: 'h2c-synthetic-no-provider' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data };
  };
  for (const user of [parent, peer, foreign]) {
    const response = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(response.status, 200, JSON.stringify(response.body)); user.token = response.body.access_token; assert.ok(user.token);
  }
  const routes = [
    ['children', 'GET', '/parent/children', 'journal', 'list'],
    ['invoices', 'GET', '/parent/invoices', 'invoices', 'list'],
    ['receipts', 'GET', '/parent/receipts', 'invoices', 'list'],
    ['feed', 'GET', `/parent/children/${child}/feed`, 'journal'],
    ['consents', 'GET', `/parent/children/${child}/consents`, 'linked'],
    ['health', 'GET', `/parent/children/${child}/health`, 'health'],
    ['photos', 'GET', `/parent/children/${child}/media`, 'journal'],
    ['photo URL', 'GET', `/parent/children/${child}/media/${media}/download`, 'journal'],
    ['invoice detail', 'GET', `/parent/invoices/${invoice}`, 'invoices'],
    ['invoice PDF', 'GET', `/parent/invoices/${invoice}/pdf`, 'invoices'],
    ['receipt detail', 'GET', `/parent/receipts/${payment}`, 'invoices'],
    ['absence', 'POST', '/parent/absence', 'journal', 'attendance_events', { child_id: child, reason: 'H2c' }],
    ['save consent', 'POST', '/parent/consents', 'linked', 'consent_records', { child_id: child, consent_type: 'data_processing', granted: true }],
  ];
  const states = ['authorized', 'guardian deleted', 'child deleted', 'membership inactive', 'user suspended', 'link removed', 'peer', 'foreign', 'journal revoked', 'health revoked', 'invoices revoked', 'restored'];
  const linkRow = (await db.query('SELECT * FROM child_guardians WHERE id=$1', [link])).rows[0];
  for (const state of states) {
    if (state === 'guardian deleted') await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1', [guardian]);
    if (state === 'child deleted') await db.query('UPDATE children SET deleted_at=NOW() WHERE id=$1', [child]);
    if (state === 'membership inactive') await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [org, parent.id]);
    if (state === 'user suspended') await db.query("UPDATE users SET status='suspended' WHERE id=$1", [parent.id]);
    if (state === 'link removed') await db.query('DELETE FROM child_guardians WHERE id=$1', [link]);
    const revoked = { 'journal revoked': 'can_view_journal', 'health revoked': 'can_view_health', 'invoices revoked': 'can_receive_invoices' }[state];
    if (revoked) await db.query(`UPDATE child_guardians SET ${revoked}=false WHERE id=$1`, [link]); // constant test-only map
    const user = state === 'peer' ? peer : state === 'foreign' ? foreign : parent;
    try {
      for (const [name, method, path, capability, kind, body] of routes) await check(`${state}: ${name}`, async () => {
        const denied = ['guardian deleted', 'child deleted', 'membership inactive', 'user suspended', 'link removed', 'peer', 'foreign'].includes(state) || state === `${capability} revoked`;
        const write = method === 'POST';
        if (kind === 'attendance_events') {
          await db.query('DELETE FROM attendance_events WHERE child_id=$1', [child]);
          await db.query('DELETE FROM attendance_sessions WHERE child_id=$1', [child]);
        }
        const count = async () => Number((await db.query(`SELECT count(*) n FROM ${kind} WHERE child_id=$1`, [child])).rows[0].n);
        const before = write ? await count() : null;
        const response = await req(method, path, user, body);
        const after = write ? await count() : null;
        // G4 (migration 062) : « membership inactive » et « user suspended »
        // sont révocatoires — le garde d'entrée refuse le JWT dépassé (401)
        // avant l'endpoint ; les états de données (guardian/child/link/capability)
        // ne touchent pas l'époque et gardent leurs refus métier 403/404/200-vide.
        const guardRevoked = state === 'membership inactive' || state === 'user suspended';
        if (denied && kind === 'list') {
          if (guardRevoked) assert.equal(response.status, 401, JSON.stringify({ status: response.status, before, after }));
          else { assert.equal(response.status, 200); assert.deepEqual(response.body, []); }
        } else if (denied) {
          if (guardRevoked) assert.equal(response.status, 401, JSON.stringify({ status: response.status, before, after }));
          else assert.ok([403, 404].includes(response.status), JSON.stringify({ status: response.status, before, after }));
          if (write) assert.equal(after, before, 'refused request cannot mutate business records');
          assert.ok(!JSON.stringify(response.body).includes('H2C_'));
        } else {
          assert.equal(response.status, write ? 201 : 200, JSON.stringify(response.body));
          if (write) assert.equal(after, before + 1);
          else if (Array.isArray(response.body)) assert.ok(response.body.length > 0);
          if (name === 'invoice detail') assert.equal(response.body.id, invoice);
          if (name === 'receipt detail') assert.equal(response.body.id, payment);
          if (name === 'health') assert.equal(response.body.allergies[0].allergen, 'H2C_ALLERGEN');
          if (name === 'photo URL') assert.ok(response.body.url.includes('X-Amz-Signature='));
          if (name === 'photos') assert.ok(response.body[0].url.includes('X-Amz-Signature='));
          if (name === 'invoice PDF') assert.ok(response.body.includes('H2C_PDF_BYTES'));
        }
      });
    } finally {
      await db.query('UPDATE guardians SET deleted_at=NULL WHERE id=$1', [guardian]);
      await db.query('UPDATE children SET deleted_at=NULL WHERE id=$1', [child]);
      await db.query('UPDATE memberships SET is_active=true WHERE organization_id=$1 AND user_id=$2', [org, parent.id]);
      await db.query("UPDATE users SET status='active' WHERE id=$1", [parent.id]);
      if (state === 'link removed') await db.query('INSERT INTO child_guardians SELECT * FROM json_populate_record(NULL::child_guardians,$1::json)', [JSON.stringify(linkRow)]);
      await db.query('UPDATE child_guardians SET can_view_journal=true,can_view_health=true,can_receive_invoices=true WHERE id=$1', [link]);
      if (state === 'membership inactive' || state === 'user suspended') {
        // G4 : la restauration est un changement réel (bump) — reconnexion.
        const r = await req('POST', '/auth/login', null, { email: parent.email, password });
        assert.equal(r.status, 200, `${state}: relogin after restore`); parent.token = r.body.access_token;
      }
    }
  }
} finally {
  if (app) await app.close();
  if (pool) await pool.end();
  await db.end(); await rm(root, { recursive: true, force: true });
}
console.log(`H2c parent access: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
