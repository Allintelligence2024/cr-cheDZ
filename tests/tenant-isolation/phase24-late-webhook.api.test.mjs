#!/usr/bin/env node
/**
 * MISSION P2 — le WEBHOOK TARDIF (point le plus important) : l'argent est
 * réellement arrivé, le fournisseur a envoyé SON webhook signé, le paiement a
 * entre-temps été passé 'failed' (expiration 72 h OU supersede à l'init).
 *
 * Comportement attendu HONNÊTE (jamais de rejet silencieux, jamais de faux
 * statut) :
 *   1. E — paiement pending backdaté de 73 h → worker `payments_expire`
 *      (051) le passe 'failed' (PENDING_EXPIRED_72H) → webhook signé valide
 *      avec SON external_reference arrive quand même → paiement 'confirmed',
 *      ALLOCATION créée sur la facture, facture SOLDÉE. Le rejeu du même
 *      webhook reste idempotent (un paiement, une allocation).
 *   2. S — paiement SUPERSEDED_BY_NEW_INIT (deux external_references
 *      distinctes R1/R2 sur la même facture) → le webhook tardif de R1 (le
 *      BON paiement, celui sur lequel l'argent est tombé) confirme R1 et
 *      alloue sur la facture via R1 — jamais via R2. R2 reste intact
 *      (pending, aucune allocation : pas de double paiement). Le webhook
 *      tardif de R2 (le mauvais) est REFUSÉ explicitement (facture soldée).
 *   3. M — montant du webhook ≠ montant du paiement → REFUS explicite
 *      (422 PAYMENT_AMOUNT_MISMATCH), paiement non confirmé, aucun écrit :
 *      le montant ne doit JAMAIS être « corrigé » silencieusement.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/),
 * migration 052 appliquée (le reset de la suite l'applique).
 * TDD : la suite est écrite AVANT le correctif — sur le code de main (039),
 * le cas M est ROUGE (webhook montant ≠ → confirmation silencieuse au
 * montant du paiement, http 200) ; migration 052 (CREATE OR REPLACE de
 * billing_webhook_apply, garde de montant) le passe en VERT. Preuve par
 * mutation : scripts/mutation-phase24-proof.sh.
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
  console.log(`${v ? '✓' : '✗'} ${n}${!v ? ` — ${detail ?? 'échec'}` : ''}`);
  if (!v) failures.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mock de la passerelle SATIM (comme phase14/22/23) : vérifie la signature HMAC. */
function startMockGateway(secret) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const canonical = [parsed.merchant_id, parsed.amount, parsed.currency, parsed.invoice_id, parsed.reference].join('|');
      const expected = createHmac('sha256', secret).update(canonical).digest('hex');
      const okSig = req.headers['x-satim-signature'] === expected;
      res.writeHead(okSig ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(okSig
        ? { redirect_url: `https://pay.satim.mock/pay?t=${randomUUID().slice(0, 8)}`, transaction_id: `TX-${randomUUID().slice(0, 6)}` }
        : { error: 'BAD_SIGNATURE' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Démarre un worker en arrière-plan (rôle applicatif NOBYPASSRLS). */
function startWorker() {
  return spawn('node', ['apps/worker/dist/main.js'], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: appUrl(), STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/tmp/creche-storage-tests' },
    stdio: 'ignore',
  });
}

/** Attend qu'un job `payments_expire` soit terminé (ou null après timeout). */
async function waitJobDone(db) {
  for (let i = 0; i < 60; i += 1) {
    const j = await db.query(
      `SELECT status, failure_reason FROM background_jobs WHERE job_type='payments_expire' ORDER BY created_at DESC, attempts DESC LIMIT 1`,
    );
    if (j.rows[0]?.status === 'done') return j.rows[0];
    if (j.rows[0]?.failure_reason != null) return j.rows[0];
    await sleep(500);
  }
  return null;
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
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = '/tmp/creche-storage-tests';
  process.env.SATIM_MERCHANT_ID = 'merchant-p24';
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
  /** Webhook de paiement signé (contrôleurs phase8/14 : HMAC-SHA256 du corps brut). */
  const webhook = async (payload) => {
    const body = JSON.stringify(payload);
    const sig = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET ?? 'phase8-test-secret').update(body).digest('hex');
    const r = await fetch(base + '/billing/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-signature': sig },
      body,
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };
  const payState = async (id) => (await db.query(`SELECT status, confirmed_at, gateway_response FROM payments WHERE id=$1`, [id])).rows[0];
  const invState = async (id) => (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [id])).rows[0];
  const allocOf = async (paymentId) => (await db.query(
    `SELECT payment_id, invoice_id, amount_allocated FROM payment_allocations WHERE payment_id=$1`, [paymentId],
  )).rows;

  const tag = `p24-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let worker = null;

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [`${tag}-a`])).rows[0].id;
    const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
    const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
    const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${tag}-director@test.dz`, hash])).rows[0].id;
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
    const child = (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P24-A1','Yanis','Test','2024-01-01',$4) RETURNING id`, [org, site, room, director],
    )).rows[0].id;
    const token = (await api('POST', '/auth/login', null, { email: `${tag}-director@test.dz`, password })).body.access_token;
    ok('JWT directeur émis', Boolean(token));

    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [org]);
    const contract = (await api('POST', '/billing/contracts', token, { child_id: child, monthly_base_amount: 10000, start_date: '2026-01-01' })).body;
    const mkInvoice = async (month) => (await api('POST', '/billing/invoices/generate', token, {
      contract_id: contract.id, period_year: 2026, period_month: month, due_date: '2026-08-05',
    })).body;
    const invE = await mkInvoice(7);
    const invS = await mkInvoice(8);
    const invM = await mkInvoice(9);
    ok('3 factures créées (10000 DZD chacune : E, S, M)', Boolean(invE.id && invS.id && invM.id));

    // ── 1. E : expiration 73 h → webhook tardif = confirmation honnête ─────
    console.log('\n1) E — paiement expiré (failed PENDING_EXPIRED_72H) → webhook tardif signé');
    const initE = await api('POST', '/billing/payments/online', token, { invoice_id: invE.id, method: 'cib' });
    ok('Init E → pending', (initE.status === 200 || initE.status === 201) && initE.body.status === 'pending', JSON.stringify(initE.body).slice(0, 160));
    const extE = initE.body.external_reference;
    // Backdate de 73 h : le parent a payé « hier » mais le job quotidien a expiré
    // le pending avant que le webhook du fournisseur n'arrive.
    await db.query(`UPDATE payments SET created_at = NOW() - INTERVAL '73 hours' WHERE id=$1`, [initE.body.id]);
    await db.query(`INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'payments_expire', '{}', 1)`);
    worker = startWorker();
    const job = await waitJobDone(db);
    worker.kill(); worker = null;
    ok('Job payments_expire → done', job?.status === 'done', JSON.stringify(job));
    const expiredE = await payState(initE.body.id);
    ok('Paiement E passé failed par expiration (PENDING_EXPIRED_72H persistée)',
      expiredE.status === 'failed' && expiredE.gateway_response?.reason === 'PENDING_EXPIRED_72H',
      JSON.stringify(expiredE.gateway_response));
    const lateE = await webhook({ external_reference: extE, invoice_id: invE.id, amount: 10000, gateway: 'cib', paid_at: new Date().toISOString() });
    ok('Webhook tardif E accepté (200 — jamais de rejet silencieux)', lateE.status === 200, `status=${lateE.status} ${JSON.stringify(lateE.body).slice(0, 160)}`);
    const confirmedE = await payState(initE.body.id);
    ok('Paiement E → confirmed (confirmed_at posée)', confirmedE.status === 'confirmed' && Boolean(confirmedE.confirmed_at), `status=${confirmedE.status}`);
    const allocE = await allocOf(initE.body.id);
    ok('Allocation créée sur la facture (E → 10000)',
      allocE.length === 1 && allocE[0].invoice_id === invE.id && Number(allocE[0].amount_allocated) === 10000,
      JSON.stringify(allocE));
    const invEAfter = await invState(invE.id);
    ok('Facture E SOLDÉE (paid, 10000)', invEAfter.status === 'paid' && Number(invEAfter.paid_amount) === 10000, JSON.stringify(invEAfter));
    // Idempotence (rejeu du cas phase14) : le fournisseur renvoie son webhook 2×.
    const lateE2 = await webhook({ external_reference: extE, invoice_id: invE.id, amount: 10000, gateway: 'cib', paid_at: new Date().toISOString() });
    const nPayE = (await db.query(`SELECT COUNT(*)::int n FROM payments WHERE external_reference=$1`, [extE])).rows[0].n;
    const nAllocE = (await allocOf(initE.body.id)).length;
    const invEAfter2 = await invState(invE.id);
    ok('Rejeu idempotent du webhook tardif (1 paiement, 1 allocation, facture toujours soldée)',
      lateE2.status === 200 && nPayE === 1 && nAllocE === 1 && invEAfter2.status === 'paid',
      `status=${lateE2.status} paiements=${nPayE} allocations=${nAllocE} facture=${invEAfter2.status}`);

    // ── 2. S : supersede à l'init → webhook tardif sur le BON paiement ─────
    console.log('\n2) S — paiement SUPERSEDED_BY_NEW_INIT (deux external_references distinctes) → webhook tardif du bon paiement');
    const initS1 = await api('POST', '/billing/payments/online', token, { invoice_id: invS.id, method: 'cib' });
    const initS2 = await api('POST', '/billing/payments/online', token, { invoice_id: invS.id, method: 'edahabia' });
    const extS1 = initS1.body.external_reference;
    const extS2 = initS2.body.external_reference;
    ok('Deux inits → deux external_references distinctes (R1, R2)',
      Boolean(extS1 && extS2) && extS1 !== extS2, `R1=${extS1} R2=${extS2}`);
    const superseded = await payState(initS1.body.id);
    const active = await payState(initS2.body.id);
    ok('R1 → failed (SUPERSEDED_BY_NEW_INIT), R2 → pending (un seul actif)',
      superseded.status === 'failed' && superseded.gateway_response?.reason === 'SUPERSEDED_BY_NEW_INIT' && active.status === 'pending',
      JSON.stringify({ R1: superseded.status, R2: active.status }));
    // Le parent a payé via la session R1 (le fournisseur ne connaît que R1) :
    // le webhook tardif arrive avec R1, alors que R2 est le pending « officiel ».
    const lateS = await webhook({ external_reference: extS1, invoice_id: invS.id, amount: 10000, gateway: 'cib', paid_at: new Date().toISOString() });
    ok('Webhook tardif sur R1 accepté (200 — jamais de rejet silencieux)', lateS.status === 200, `status=${lateS.status} ${JSON.stringify(lateS.body).slice(0, 160)}`);
    const confirmedS1 = await payState(initS1.body.id);
    ok('R1 → confirmed (l\'argent est tombé sur R1)', confirmedS1.status === 'confirmed', `status=${confirmedS1.status}`);
    const allocS = await allocOf(initS1.body.id);
    ok('Allocation créée VIA LE BON PAIEMENT (R1 → facture S, 10000)',
      allocS.length === 1 && allocS[0].invoice_id === invS.id && Number(allocS[0].amount_allocated) === 10000,
      JSON.stringify(allocS));
    const invSAfter = await invState(invS.id);
    ok('Facture S SOLDÉE (paid, 10000)', invSAfter.status === 'paid' && Number(invSAfter.paid_amount) === 10000, JSON.stringify(invSAfter));
    const pendingS2 = await payState(initS2.body.id);
    const allocS2 = await allocOf(initS2.body.id);
    ok('R2 (supersédé→remplaçant) intact : pending, AUCUNE allocation (pas de double paiement)',
      pendingS2.status === 'pending' && allocS2.length === 0,
      JSON.stringify({ status: pendingS2.status, allocations: allocS2.length }));
    const lateS2 = await webhook({ external_reference: extS2, invoice_id: invS.id, amount: 10000, gateway: 'edahabia', paid_at: new Date().toISOString() });
    ok('Webhook tardif sur R2 (le mauvais) REFUSÉ explicitement (422 INVOICE_IMMUTABLE)',
      lateS2.status === 422 && lateS2.body.code === 'INVOICE_IMMUTABLE',
      `status=${lateS2.status} code=${lateS2.body.code}`);

    // ── 3. M : montant du webhook ≠ montant du paiement → refus explicite ──
    console.log('\n3) M — montant du webhook (9999) ≠ montant du paiement (10000)');
    const initM = await api('POST', '/billing/payments/online', token, { invoice_id: invM.id, method: 'cib' });
    ok('Init M → pending (10000)', (initM.status === 200 || initM.status === 201) && initM.body.status === 'pending' && Number(initM.body.amount) === 10000, JSON.stringify(initM.body).slice(0, 160));
    const lateM = await webhook({ external_reference: initM.body.external_reference, invoice_id: invM.id, amount: 9999, gateway: 'cib', paid_at: new Date().toISOString() });
    ok('Webhook montant ≠ du paiement → REFUSÉ explicitement (422 PAYMENT_AMOUNT_MISMATCH)',
      lateM.status === 422 && lateM.body.code === 'PAYMENT_AMOUNT_MISMATCH',
      `status=${lateM.status} code=${lateM.body.code} ${JSON.stringify(lateM.body).slice(0, 160)}`);
    const untouchedM = await payState(initM.body.id);
    const allocM = await allocOf(initM.body.id);
    const invMAfter = await invState(invM.id);
    ok('Paiement M non confirmé, aucune allocation, facture non soldée (le montant n’est jamais « corrigé » silencieusement)',
      untouchedM.status === 'pending' && allocM.length === 0 && invMAfter.status !== 'paid' && Number(invMAfter.paid_amount) === 0,
      JSON.stringify({ status: untouchedM.status, allocations: allocM.length, invoice: invMAfter }));
  } finally {
    gateway.server.close();
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM background_jobs WHERE job_type='payments_expire' OR organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p24-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p24-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p24-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p24-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase24 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 24 webhook tardif : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 24 webhook tardif validée (E expiré + S superseded + M montant ≠ : confirmation honnête, jamais de rejet silencieux) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
