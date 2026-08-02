#!/usr/bin/env node
/**
 * Phase 14 (roadmap v2) — paiement en ligne CIB/Edahabia (adaptateur SATIM),
 * avec deux tenants A/B, sur PostgreSQL réel avec le rôle NOBYPASSRLS.
 *
 * La passerelle est un SERVEUR HTTP LOCAL (mock du fournisseur) : le code de
 * l'adaptateur fait de VRAIS appels HTTP (fetch + signature HMAC-SHA256) ;
 * le mock vérifie la signature reçue. En production, SATIM_GATEWAY_URL pointe
 * vers la passerelle réelle (non configurée ici — les chemins d'échec 503/502
 * sont testés). Le webhook de confirmation est l'existant (024).
 *
 * Cas couverts :
 *   1. flag online_payment désactivé → 422 FEATURE_DISABLED ;
 *   2. flag activé mais passerelle non configurée → 503 PAYMENT_PROVIDER_NOT_CONFIGURED ;
 *   3. passerelle mock configurée : init réussi → redirect_url + paiement pending ;
 *   4. le mock reçoit une signature HMAC valide ;
 *   5. webhook de confirmation signé → paiement confirmé + facture payée ;
 *   6. passerelle injoignable → 502 PAYMENT_GATEWAY_ERROR + paiement failed ;
 *   7. B ne crée pas de paiement en ligne pour la facture de A (404) ;
 *   8. paiement sur facture payée → 422 INVOICE_IMMUTABLE.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API compilée (dist/).
 */
import { execSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

/** Mock de la passerelle SATIM : vérifie la signature HMAC et répond redirect_url. */
function startMockGateway(secret) {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, signature: req.headers['x-satim-signature'], body });
      // Le client signe une chaîne canonique (champs séparés par |) :
      // merchant_id|amount|currency|invoice_id|reference
      const parsed = JSON.parse(body);
      const canonical = [parsed.merchant_id, parsed.amount, parsed.currency, parsed.invoice_id, parsed.reference].join('|');
      const expected = createHmac('sha256', secret).update(canonical).digest('hex');
      const okSig = req.headers['x-satim-signature'] === expected;
      res.writeHead(okSig ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(okSig
        ? { redirect_url: 'https://pay.satim.mock/pay?t=abc', transaction_id: 'TX-MOCK-1' }
        : { error: 'BAD_SIGNATURE' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
  });
}

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);

  const satimSecret = `test-secret-${randomUUID()}`;
  const gateway = await startMockGateway(satimSecret);

  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.SATIM_MERCHANT_ID = 'merchant-mock';
  process.env.SATIM_SECRET = satimSecret;
  process.env.SATIM_GATEWAY_URL = `http://127.0.0.1:${gateway.port}`;

  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `pay-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const childA = (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'PAY-A1','Yanis','Test','2024-01-01',$4) RETURNING id`, [A.org, A.site, A.room, A.director],
    )).rows[0].id;
    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: childA, monthly_base_amount: 10000, start_date: '2026-01-01' })).body;
    const invoice = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' })).body;
    ok('Facture A créée (10000 DZD)', Boolean(invoice.id));

    // ── 1. Flag désactivé ────────────────────────────────────────────────────
    console.log('\n1) Flag online_payment désactivé');
    const disabled = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice.id, method: 'cib' });
    ok('Flag off → 422 FEATURE_DISABLED', disabled.status === 422 && disabled.body.code === 'FEATURE_DISABLED', JSON.stringify(disabled.body).slice(0, 100));

    // ── 2. Flag activé, config absente ──────────────────────────────────────
    console.log('\n2) Passerelle non configurée (503)');
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [A.org]);
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [B.org]);
    const savedGatewayUrl = process.env.SATIM_GATEWAY_URL;
    delete process.env.SATIM_GATEWAY_URL;
    const noConfig = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice.id, method: 'edahabia' });
    ok('Sans SATIM_GATEWAY_URL → 503 PAYMENT_PROVIDER_NOT_CONFIGURED', noConfig.status === 503 && noConfig.body.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED', JSON.stringify(noConfig.body).slice(0, 120));
    process.env.SATIM_GATEWAY_URL = savedGatewayUrl;

    // ── 3/4. Init réussi via le mock ────────────────────────────────────────
    console.log('\n3/4) Init passerelle (mock local, HTTP réel)');
    const init = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice.id, method: 'cib' });
    ok('Init → 201 avec redirect_url + paiement pending', (init.status === 200 || init.status === 201) && init.body.redirect_url?.includes('pay.satim.mock') && init.body.status === 'pending', JSON.stringify(init.body).slice(0, 160));
    const paymentId = init.body.id;
    const extRef = init.body.external_reference;
    const mockHit = gateway.received[0];
    ok('Le mock a reçu la requête /payment/init', mockHit?.path === '/payment/init', JSON.stringify(mockHit?.path));
    ok('Le mock a validé la signature HMAC (sinon 401)', Boolean(mockHit) && gateway.received.length === 1, `reçues=${gateway.received.length}`);

    // ── 5. Webhook de confirmation → facture payée ──────────────────────────
    console.log('\n5) Confirmation webhook (existant, signé, idempotent)');
    const webhookBody = JSON.stringify({ external_reference: extRef, invoice_id: invoice.id, amount: 10000, gateway: 'cib' });
    const sign = (b) => createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET ?? 'phase8-test-secret').update(b).digest('hex');
    const confirm = await fetch(base + '/billing/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-signature': sign(webhookBody) },
      body: webhookBody,
    });
    ok('Webhook confirmé (200)', confirm.status === 200);
    const payState = await db.query(`SELECT status, confirmed_at FROM payments WHERE id=$1`, [paymentId]);
    ok('Paiement → confirmed', payState.rows[0].status === 'confirmed' && Boolean(payState.rows[0].confirmed_at));
    const invState = await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [invoice.id]);
    ok('Facture → paid (10000)', invState.rows[0].status === 'paid' && Number(invState.rows[0].paid_amount) === 10000);

    // ── 8. Paiement sur facture payée ───────────────────────────────────────
    console.log('\n8) Facture payée immuable');
    process.env.SATIM_GATEWAY_URL = `http://127.0.0.1:${gateway.port}`;
    const onPaid = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice.id, method: 'cib' });
    ok('Paiement en ligne sur facture payée → 422 INVOICE_IMMUTABLE', onPaid.status === 422 && onPaid.body.code === 'INVOICE_IMMUTABLE', JSON.stringify(onPaid.body).slice(0, 100));

    // ── 7. Isolation B ──────────────────────────────────────────────────────
    console.log('\n7) Isolation (org B)');
    const cross = await api('POST', '/billing/payments/online', tokenB, { invoice_id: invoice.id, method: 'edahabia' });
    ok('B : paiement en ligne sur la facture de A → 404', cross.status === 404, JSON.stringify(cross.body).slice(0, 100));

    // ── 6. Passerelle injoignable → 502 ─────────────────────────────────────
    console.log('\n6) Passerelle injoignable (502)');
    const invoice2 = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 8, due_date: '2026-09-05' })).body;
    process.env.SATIM_GATEWAY_URL = 'http://127.0.0.1:1';
    const down = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice2.id, method: 'cib' });
    ok('Passerelle injoignable → 502 PAYMENT_GATEWAY_ERROR', down.status === 502 && down.body.code === 'PAYMENT_GATEWAY_ERROR', JSON.stringify(down.body).slice(0, 120));
    const failedPay = await db.query(
      `SELECT status FROM payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [A.org],
    );
    ok('Paiement marqué failed en base', failedPay.rows[0]?.status === 'failed', JSON.stringify(failedPay.rows[0]));
  } finally {
    gateway.server.close();
    try {
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pay-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pay-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pay-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'pay-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'pay-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase14 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 14 paiement en ligne : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 14 paiement en ligne validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
