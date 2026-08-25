#!/usr/bin/env node
/**
 * MISSION P1 — expiration des paiements en ligne SATIM 'pending' (feat billing)
 * + supersede à l'init (un seul pending actif par facture).
 *
 * Avec deux tenants (A/B) et le rôle NOBYPASSRLS (appUrl), sur PostgreSQL 18 :
 *   1. Worker `payments_expire` (job global organization_id NULL, pattern
 *      video_clips_purge) : pending SATIM backdaté de 73 h → ligne 'failed',
 *      gateway_response || {"expired":true,"reason":"PENDING_EXPIRED_72H"}
 *      persistée ; pending récent (< 72 h) CONSERVÉ ; AUCUNE suppression de
 *      ligne (traçabilité compta) ; facture jamais marquée payée ;
 *   2. Idempotence : second cycle du job → aucun changement (re-run safe) ;
 *   3. Init (createOnlinePayment) avec un pending existant de la MÊME facture
 *      → ancien 'failed' (reason SUPERSEDED_BY_NEW_INIT), nouveau 'pending' ;
 *      exactement UN pending actif ; la facture n'est PAS payée pour autant ;
 *   4. B ne peut pas voir/affecter les paiements de A (isolation RLS).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/),
 * migration 051 appliquée (le reset du suite l'applique).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mock de la passerelle SATIM (comme phase14/22) : vérifie la signature HMAC. */
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

/** Démarre un worker en arrière-plan ; retourne le process à tuer. */
function startWorker() {
  return spawn('node', ['apps/worker/dist/main.js'], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: appUrl(), STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/tmp/creche-storage-tests' },
    stdio: 'ignore',
  });
}

/** Attend qu'un job `payments_expire` soit 'done' (ou renvoie null après timeout). */
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
  process.env.SATIM_MERCHANT_ID = 'merchant-p23';
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

  const tag = `p23-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let worker = null;
  let orgA = null; let orgB = null;

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
    orgA = A.org; orgB = B.org;
    const childA = (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P23-A1','Yanis','Test','2024-01-01',$4) RETURNING id`, [A.org, A.site, A.room, A.director],
    )).rows[0].id;
    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    // Les deux orgs activent le flag : le test d'isolation (cas 4) doit
    // traverser assertFeatureEnabled pour atteindre la facture de A (404),
    // comme dans phase14 — B n'est PAS discriminé avant le contrôle RLS.
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [A.org]);
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [B.org]);

    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: childA, monthly_base_amount: 10000, start_date: '2026-01-01' })).body;
    const invoice1 = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' })).body;
    const invoice2 = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 8, due_date: '2026-09-05' })).body;
    ok('Factures A créées (juillet + août, 10000 DZD)', Boolean(invoice1.id && invoice2.id));

    // ── 1. Worker : expiration 72 h (jamais de suppression) ────────────────
    console.log('\n1) Worker payments_expire — pending SATIM > 72 h → failed (raison persistée)');
    const invBefore = (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [invoice1.id])).rows[0];
    const expiredId = (await db.query(
      `INSERT INTO payments (organization_id, reference_number, child_id, amount, method, status,
         external_reference, payment_gateway, created_by, invoice_id, created_at)
       VALUES ($1,$2,$3,10000,'cib','pending',$4,'satim',$5,$6,NOW() - INTERVAL '73 hours') RETURNING id`,
      [A.org, `ONL-P23-E1`, childA, `satim-exp-${randomUUID()}`, A.director, invoice1.id],
    )).rows[0].id;
    const recentId = (await db.query(
      `INSERT INTO payments (organization_id, reference_number, child_id, amount, method, status,
         external_reference, payment_gateway, created_by, invoice_id, created_at)
       VALUES ($1,$2,$3,10000,'cib','pending',$4,'satim',$5,$6,NOW() - INTERVAL '1 hour') RETURNING id`,
      [A.org, `ONL-P23-R1`, childA, `satim-rec-${randomUUID()}`, A.director, invoice1.id],
    )).rows[0].id;
    await db.query(`INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'payments_expire', '{}', 1)`);
    worker = startWorker();
    const job1 = await waitJobDone(db);
    worker.kill(); worker = null;
    ok('Job payments_expire → done (premier cycle)', job1?.status === 'done', JSON.stringify(job1));
    const expired = (await db.query(
      `SELECT status, gateway_response FROM payments WHERE id=$1`, [expiredId],
    )).rows[0];
    ok('Pending backdaté 73 h → failed', expired.status === 'failed', `status=${expired.status}`);
    ok('gateway_response expiré persisté (expired=true, PENDING_EXPIRED_72H)',
      expired.gateway_response?.expired === true && expired.gateway_response?.reason === 'PENDING_EXPIRED_72H',
      JSON.stringify(expired.gateway_response));
    const recent = (await db.query(`SELECT status FROM payments WHERE id=$1`, [recentId])).rows[0];
    ok('Pending récent (1 h) CONSERVÉ (status pending)', recent.status === 'pending', `status=${recent.status}`);
    const rows1 = (await db.query(`SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id=$1`, [invoice1.id])).rows[0].n;
    ok('AUCUNE suppression de ligne (2 paiements toujours présents)', rows1 === 2, `n=${rows1}`);
    const invAfter = (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [invoice1.id])).rows[0];
    ok('Facture NON marquée payée (status + paid_amount inchangés)',
      invAfter.status === invBefore.status && Number(invAfter.paid_amount) === Number(invBefore.paid_amount),
      `before=${JSON.stringify(invBefore)} after=${JSON.stringify(invAfter)}`);

    // ── 2. Idempotence ─────────────────────────────────────────────────────
    console.log('\n2) Idempotence : deuxième cycle → aucun changement');
    await db.query(`INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'payments_expire', '{}', 1)`);
    worker = startWorker();
    const job2 = await waitJobDone(db);
    worker.kill(); worker = null;
    ok('Job payments_expire → done (deuxième cycle, sans échec ni retry)', job2?.status === 'done', JSON.stringify(job2));
    const expired2 = (await db.query(
      `SELECT status, gateway_response FROM payments WHERE id=$1`, [expiredId],
    )).rows[0];
    ok('Rejeu idempotent : ligne déjà failed, même raison (pas de faux « expiré » en double)',
      expired2.status === 'failed' && expired2.gateway_response?.reason === 'PENDING_EXPIRED_72H',
      JSON.stringify(expired2));

    // ── 3. Init : supersede des pending de la MÊME facture ─────────────────
    console.log('\n3) Init paiement : pending existant → SUPERSEDED_BY_NEW_INIT, un seul pending');
    const inv2Before = (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [invoice2.id])).rows[0];
    const init1 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice2.id, method: 'cib' });
    ok('Init 1 → pending (redirect_url)', (init1.status === 200 || init1.status === 201) && init1.body.status === 'pending', JSON.stringify(init1.body).slice(0, 160));
    const init2 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: invoice2.id, method: 'edahabia' });
    ok('Init 2 → nouveau pending (redirect_url)', (init2.status === 200 || init2.status === 201) && init2.body.status === 'pending', JSON.stringify(init2.body).slice(0, 160));
    const oldP = (await db.query(
      `SELECT status, gateway_response, invoice_id FROM payments WHERE id=$1`, [init1.body.id],
    )).rows[0];
    const newP = (await db.query(
      `SELECT status, gateway_response, invoice_id FROM payments WHERE id=$1`, [init2.body.id],
    )).rows[0];
    ok('Ancien pending → failed (SUPERSEDED_BY_NEW_INIT)',
      oldP.status === 'failed' && oldP.gateway_response?.superseded === true && oldP.gateway_response?.reason === 'SUPERSEDED_BY_NEW_INIT',
      JSON.stringify(oldP));
    ok('Nouveau paiement → pending, lié à la facture (invoice_id)',
      newP.status === 'pending' && newP.invoice_id === invoice2.id, JSON.stringify(newP));
    const pendCount = (await db.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id=$1 AND status='pending' AND payment_gateway='satim'`, [invoice2.id],
    )).rows[0].n;
    ok('UN SEUL pending actif pour la facture', pendCount === 1, `n=${pendCount}`);
    const inv2After = (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [invoice2.id])).rows[0];
    ok('Facture NON marquée payée après supersede (status + paid_amount inchangés)',
      inv2After.status === inv2Before.status && Number(inv2After.paid_amount) === Number(inv2Before.paid_amount),
      `before=${JSON.stringify(inv2Before)} after=${JSON.stringify(inv2After)}`);

    // ── 4. Isolation B ─────────────────────────────────────────────────────
    console.log('\n4) Isolation (org B)');
    const cross = await api('POST', '/billing/payments/online', tokenB, { invoice_id: invoice2.id, method: 'cib' });
    ok('B ne crée pas de paiement en ligne sur la facture de A (404)', cross.status === 404, JSON.stringify(cross.body).slice(0, 100));
    const bPayments = (await db.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE organization_id=$1 AND invoice_id IS NOT NULL`, [B.org],
    )).rows[0].n;
    ok('Aucun paiement créé chez B', bPayments === 0, `n=${bPayments}`);
  } finally {
    gateway.server.close();
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM background_jobs WHERE job_type='payments_expire' OR organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p23-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p23-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p23-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p23-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase23 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 23 expiration pending : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 23 expiration pending SATIM validée (4 cas, worker + supersede init) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
