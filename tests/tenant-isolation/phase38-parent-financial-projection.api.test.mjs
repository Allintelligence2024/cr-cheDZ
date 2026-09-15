#!/usr/bin/env node
// H2d: real HTTP/API + PG, synthetic loopback payment gateway. Fresh *_test required.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';

const url = process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: url }); await db.connect();
const root = await mkdtemp(join(tmpdir(), 'creche-h2d-'));
const secret = 'h2d-synthetic-gateway-secret-only';
const gatewayData = { redirect_url: 'http://127.0.0.1:9/pay/SENSITIVE_REDIRECT', transaction_id: 'SENSITIVE_TRANSACTION', diagnostics: { internal: 'SENSITIVE_PROVIDER_PAYLOAD' } };
let app, pool, gateway, gatewayError, gatewayCalls = 0, passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}: ${error.stack}`); }
}
const invoiceKeys = 'id child_id invoice_number period_year period_month subtotal discount_amount total_amount paid_amount balance status due_date sent_at created_at updated_at pdf_ready child_first_name child_last_name'.split(' ');
const receiptKeys = 'id child_id reference_number receipt_number amount currency method status received_at confirmed_at created_at child_first_name child_last_name'.split(' ');
const exactKeys = (object, keys) => assert.deepEqual(Object.keys(object).sort(), [...keys].sort());
try {
  await ensureAppRole(db);
  gateway = createServer((request, response) => {
    void (async () => {
      assert.equal(request.url, '/payment/init'); assert.equal(request.method, 'POST');
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const canonical = `${body.merchant_id}|${body.amount}|${body.currency}|${body.invoice_id}|${body.reference}`;
      assert.equal(request.headers['x-satim-signature'], createHmac('sha256', secret).update(canonical).digest('hex'));
      assert.equal(body.amount, '80.00'); gatewayCalls++;
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(gatewayData));
    })().catch(error => { gatewayError = error; response.writeHead(500); response.end(); });
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const password = 'Synthetic-H2d-only!', hash = await bcrypt.hash(password, 4);
  const makeOrg = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2d','31') RETURNING id", [randomUUID()])).rows[0].id;
  const org = await makeOrg(), other = await makeOrg();
  const actor = async (role, tenant = org) => {
    const email = `${randomUUID()}@test.invalid`;
    const id = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2d','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [tenant, id, role]);
    return { id, email };
  };
  const director = await actor('director'), accountant = await actor('accountant'), parent = await actor('parent_primary'), peer = await actor('parent_primary'), foreign = await actor('parent_primary', other);
  const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2d') RETURNING id", [org])).rows[0].id;
  const child = (await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'H2D_CHILD','Synthetic','2024-01-01',$3) RETURNING id", [org, site, director.id])).rows[0].id;
  const guardian = (await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'H2d','Synthetic','parent',$3) RETURNING id", [org, parent.id, director.id])).rows[0].id;
  const link = (await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_receive_invoices) VALUES($1,$2,$3,true) RETURNING id', [org, child, guardian])).rows[0].id;
  const invoice = (await db.query("INSERT INTO invoices(organization_id,child_id,invoice_number,period_year,period_month,subtotal,total_amount,due_date,created_by,notes) VALUES($1,$2,$3,2026,9,100,100,'2026-09-30',$4,'SENSITIVE_INVOICE_NOTE') RETURNING id", [org, child, randomUUID(), director.id])).rows[0].id;
  await db.query("INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price) VALUES($1,$2,'Garde','الحضانة',2,50,100)", [org, invoice]);
  const key = `${org}/invoices/${invoice}.pdf`;
  await mkdir(dirname(join(root, key)), { recursive: true });
  await writeFile(join(root, key), '%PDF-1.4\nH2D_PDF_BYTES\n%%EOF');
  await db.query('UPDATE invoices SET pdf_url=$1 WHERE id=$2', [key, invoice]);
  await db.query("INSERT INTO feature_flags(organization_id,flag_key,is_enabled) VALUES($1,'online_payment',true)", [org]);
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: root,
    SATIM_MERCHANT_ID: 'h2d-synthetic', SATIM_SECRET: secret, SATIM_GATEWAY_URL: `http://127.0.0.1:${gateway.address().port}`, SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req = async (method, path, user, body) => {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(user?.token ? { authorization: `Bearer ${user.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data };
  };
  for (const user of [director, accountant, parent, peer, foreign]) {
    const response = await req('POST', '/auth/login', null, { email: user.email, password });
    assert.equal(response.status, 200, JSON.stringify(response.body)); user.token = response.body.access_token; assert.ok(user.token);
  }
  const cash = await req('POST', '/billing/payments/cash', accountant, { invoice_id: invoice, amount: 20, notes: 'SENSITIVE_PAYMENT_NOTE' });
  assert.equal(cash.status, 201, JSON.stringify(cash.body)); const payment = cash.body.id;
  const online = await req('POST', '/billing/payments/online', accountant, { invoice_id: invoice, method: 'cib' });
  if (gatewayError) throw gatewayError;
  assert.equal(online.status, 201, JSON.stringify(online.body)); const pending = online.body.id;
  const paths = ['/parent/invoices', `/parent/invoices/${invoice}`, '/parent/receipts', `/parent/receipts/${payment}`];
  const objects = [];
  for (const [i, path] of paths.entries()) {
    const response = await req('GET', path, parent); assert.equal(response.status, 200, JSON.stringify(response.body));
    objects.push(i % 2 === 0 ? response.body[0] : response.body);
    await check(`${path}: explicit public fields only`, async () => {
      exactKeys(objects[i], i < 2 ? [...invoiceKeys, ...(i === 1 ? ['lines'] : [])] : receiptKeys);
    });
    await check(`${path}: no internal notes, provider data or storage locator`, async () => {
      for (const field of ['notes', 'gateway_response', 'external_reference', 'payment_gateway', 'created_by', 'organization_id', 'contract_id', 'pdf_url', 'receipt_url', 'invoice_id']) assert.equal(objects[i][field], undefined, field);
      assert.ok(!JSON.stringify(objects[i]).includes('SENSITIVE_'));
    });
  }
  await check('invoice totals, dates and child identity retained in list and detail', async () => {
    for (const object of objects.slice(0, 2)) {
      assert.equal(object.id, invoice); assert.equal(object.child_first_name, 'H2D_CHILD');
      assert.equal(Number(object.total_amount), 100); assert.equal(Number(object.paid_amount), 20); assert.equal(Number(object.balance), 80);
      assert.equal(object.status, 'partially_paid'); assert.ok(object.due_date.startsWith('2026-09-30'));
    }
  });
  await check('invoice lines and bilingual descriptions retained', async () => {
    const line = objects[1].lines[0]; exactKeys(line, 'id description_fr description_ar quantity unit_price total_price line_type'.split(' '));
    assert.equal(line.description_fr, 'Garde'); assert.equal(line.description_ar, 'الحضانة'); assert.equal(Number(line.total_price), 100);
  });
  await check('receipt amount, public references, method and status retained', async () => {
    for (const object of objects.slice(2)) {
      assert.equal(object.id, payment); assert.equal(Number(object.amount), 20); assert.equal(object.reference_number, cash.body.reference_number);
      assert.equal(object.receipt_number, cash.body.receipt_number); assert.equal(object.method, 'cash'); assert.equal(object.status, 'confirmed');
    }
  });
  await check('gateway HTTP was signed and raw response is persisted, not erased', async () => {
    assert.equal(gatewayCalls, 1);
    assert.deepEqual((await db.query('SELECT gateway_response FROM payments WHERE id=$1', [pending])).rows[0].gateway_response, gatewayData);
  });
  await check('actual gateway response does not cross the parent detail boundary', async () => {
    const response = await req('GET', `/parent/receipts/${pending}`, parent); assert.equal(response.status, 200);
    assert.equal(response.body.status, 'pending'); assert.equal(Number(response.body.amount), 80);
    exactKeys(response.body, receiptKeys); assert.ok(!JSON.stringify(response.body).includes('SENSITIVE_'));
  });
  await check('receipt list still excludes pending payments (already protected)', async () => {
    const response = await req('GET', '/parent/receipts', parent); assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(row => row.id), [payment]);
  });
  for (const [state, value, ready] of [['stored', key, true], ['missing', null, false], ['empty', '', false]]) await check(`PDF readiness: ${state}, no raw key`, async () => {
    await db.query('UPDATE invoices SET pdf_url=$1 WHERE id=$2', [value, invoice]);
    try {
      for (const path of paths.slice(0, 2)) {
        const response = await req('GET', path, parent); assert.equal(response.status, 200);
        const object = Array.isArray(response.body) ? response.body[0] : response.body;
        assert.equal(object.pdf_ready, ready); assert.equal(object.pdf_url, undefined);
      }
    } finally { await db.query('UPDATE invoices SET pdf_url=$1 WHERE id=$2', [key, invoice]); }
  });
  await check('authorized PDF endpoint still serves local bytes', async () => {
    const response = await req('GET', `/parent/invoices/${invoice}/pdf`, parent); assert.equal(response.status, 200); assert.ok(response.body.includes('H2D_PDF_BYTES'));
  });
  await check('accountant invoice detail keeps internal notes and storage reference', async () => {
    const response = await req('GET', `/billing/invoices/${invoice}`, accountant); assert.equal(response.status, 200);
    assert.equal(response.body.notes, 'SENSITIVE_INVOICE_NOTE'); assert.equal(response.body.pdf_url, key);
  });
  await check('accountant payment detail keeps notes, gateway response and allocations', async () => {
    const response = await req('GET', `/billing/payments/${payment}`, accountant); assert.equal(response.status, 200);
    assert.equal(response.body.notes, 'SENSITIVE_PAYMENT_NOTE'); assert.equal(Number(response.body.allocations[0].amount_allocated), 20);
    const onlineDetail = await req('GET', `/billing/payments/${pending}`, accountant); assert.equal(onlineDetail.status, 200); assert.deepEqual(onlineDetail.body.gateway_response, gatewayData);
  });
  for (const path of [`/billing/invoices/${invoice}`, `/billing/payments/${pending}`]) await check(`parent cannot bypass via ${path} (already protected)`, async () => {
    assert.equal((await req('GET', path, parent)).status, 403);
  });
  await check('privacy rights export already excludes raw financial internals, including stored JSON', async () => {
    const request = await req('POST', '/privacy/requests', parent, { request_type: 'access', subject_id: child }); assert.equal(request.status, 201);
    const response = await req('POST', `/privacy/requests/${request.body.id}/export`, parent); assert.equal(response.status, 201);
    assert.ok(!JSON.stringify(response.body.payload.invoices).includes('SENSITIVE_')); assert.ok(!JSON.stringify(response.body.payload.payments).includes('SENSITIVE_'));
    assert.deepEqual((await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1', [response.body.export_id])).rows[0].payload, response.body.payload);
  });
  for (const state of ['peer', 'foreign', 'invoice capability revoked', 'guardian deleted']) {
    if (state === 'invoice capability revoked') await db.query('UPDATE child_guardians SET can_receive_invoices=false WHERE id=$1', [link]);
    if (state === 'guardian deleted') await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1', [guardian]);
    const user = state === 'peer' ? peer : state === 'foreign' ? foreign : parent;
    try {
      for (const [i, path] of [...paths, `/parent/invoices/${invoice}/pdf`].entries()) await check(`${state}: ${path}`, async () => {
        const response = await req('GET', path, user);
        if (i === 0 || i === 2) { assert.equal(response.status, 200); assert.deepEqual(response.body, []); }
        else assert.ok([403, 404].includes(response.status), String(response.status));
      });
    } finally {
      await db.query('UPDATE child_guardians SET can_receive_invoices=true WHERE id=$1', [link]);
      await db.query('UPDATE guardians SET deleted_at=NULL WHERE id=$1', [guardian]);
    }
  }
  await check('reads preserve ledger and internal evidence', async () => {
    const row = (await db.query('SELECT paid_amount,balance,notes,pdf_url FROM invoices WHERE id=$1', [invoice])).rows[0];
    assert.equal(Number(row.paid_amount), 20); assert.equal(Number(row.balance), 80); assert.equal(row.notes, 'SENSITIVE_INVOICE_NOTE'); assert.equal(row.pdf_url, key);
    assert.deepEqual((await db.query('SELECT gateway_response FROM payments WHERE id=$1', [pending])).rows[0].gateway_response, gatewayData);
  });
} finally {
  if (app) await app.close(); if (pool) await pool.end();
  if (gateway) await new Promise(resolve => gateway.close(resolve));
  await db.end(); await rm(root, { recursive: true, force: true });
}
console.log(`H2d financial projection: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
