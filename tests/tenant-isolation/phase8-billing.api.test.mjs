#!/usr/bin/env node
/**
 * Phase 8 GATE — facturation (contrats, factures, paiements, caisse, PDF,
 * webhook) avec deux tenants A/B, exécuté sur PostgreSQL réel avec le rôle
 * applicatif NOBYPASSRLS (creche_app_test).
 *
 * Cas couverts :
 *   1.  B ne lit pas contrats/factures/paiements/caisses de A (404/vide) ;
 *   2.  B ne crée pas contrat/facture pour l'enfant de A (404) ;
 *   3.  génération mensuelle deux fois = UNE seule facture (409 + index 021) ;
 *   4.  paiement espèces partiel → solde mis à jour ;
 *   5.  paiement > solde → 422 PAYMENT_EXCEEDS_BALANCE ;
 *   6.  allocation > paiement → refus base PostgreSQL (trigger 023 → 422) ;
 *   7.  allocation > solde facture → refus base PostgreSQL (trigger 023 → 422) ;
 *   8.  facture payée immuable (422 + trigger C04 en SQL direct) ;
 *   9.  webhook signé répété 3× = UN paiement ; signature invalide → 401 ;
 *  10.  ouverture double de caisse → 409 ;
 *  11.  clôture double → 409 ;
 *  12.  total caisse = somme exacte des paiements espèces confirmés ;
 *  13.  job PDF créé et traité par le worker (sous NOBYPASSRLS) ;
 *  14.  PDF stocké (backend local configuré) + URL/endpoint autorisé ;
 *  15.  parent A lit uniquement les factures de ses enfants (can_receive_invoices) ;
 *  16.  parent B (org B) ne consulte jamais les factures de A.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/).
 */
import { execSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
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

async function waitFor(check, label, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await sleep(500);
  }
  ok(label, false, `timeout ${timeoutMs}ms`);
  return false;
}

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  const pdfDir = process.env.STORAGE_LOCAL_DIR ?? '/tmp/pgtest/pdfstore';
  rmSync(pdfDir, { recursive: true, force: true });

  // Base propre : la suite est autonome et ne pollue pas les autres phases.
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = pdfDir;
  process.env.PAYMENT_WEBHOOK_SECRET = 'phase8-test-secret';

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

  const tag = `p8-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const periodYear = 2026;
  const periodMonth = 7;

  let worker;
  try {
    // ── Setup : org A (directeur, enfant, contrat) + org B (directeur) ─────
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const parentRole = await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`);
    const mkOrg = async (slug, name) => {
      const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,$2,'31') RETURNING id`, [slug, name]);
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`, 'P8A');
    const B = await mkOrg(`${tag}-b`, 'P8B');
    const childA = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P8-1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [A.org, A.site, A.room, A.director],
    );
    const childB = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P8-2','Lina','Test','2024-02-01',$4) RETURNING id`,
      [B.org, B.site, B.room, B.director],
    );
    const mkParent = async (email, orgId, childId, canReceive) => {
      const u = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`, [email, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u.rows[0].id, parentRole.rows[0].id]);
      const g = await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`, [orgId, u.rows[0].id, A.director]);
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_receive_invoices) VALUES($1,$2,$3,true,$4)`, [orgId, childId, g.rows[0].id, canReceive]);
      return u.rows[0].id;
    };
    await mkParent(`${tag}-parent-a@test.dz`, A.org, childA.rows[0].id, true);
    await mkParent(`${tag}-parent-b@test.dz`, B.org, childB.rows[0].id, true);

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenParentA = (await api('POST', '/auth/login', null, { email: `${tag}-parent-a@test.dz`, password })).body.access_token;
    const tokenParentB = (await api('POST', '/auth/login', null, { email: `${tag}-parent-b@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B et parents A/B émis', Boolean(tokenA && tokenB && tokenParentA && tokenParentB));

    // ── Contrat + facture côté A ────────────────────────────────────────────
    const contract = await api('POST', '/billing/contracts', tokenA, {
      child_id: childA.rows[0].id, monthly_base_amount: 10000, start_date: '2026-01-01', discount_percent: 0,
    });
    ok('A crée un contrat', contract.status === 201, JSON.stringify(contract.body).slice(0, 120));
    const contractId = contract.body.id;
    const invoiceFA = await api('POST', '/billing/invoices/generate', tokenA, {
      contract_id: contractId, period_year: periodYear, period_month: periodMonth, due_date: '2026-08-05',
    });
    ok('A génère la facture mensuelle (10000 DZD)', invoiceFA.status === 201 && Number(invoiceFA.body.total_amount) === 10000, JSON.stringify(invoiceFA.body).slice(0, 120));
    const invoiceAId = invoiceFA.body.id;

    // ── 1. B ne lit rien de A ───────────────────────────────────────────────
    console.log('\n1) B ne lit pas les ressources de facturation de A');
    const bContracts = await api('GET', '/billing/contracts', tokenB);
    ok('B : liste contrats ne contient pas le contrat de A', bContracts.status === 200 && !bContracts.body.some((c) => c.id === contractId));
    ok('B : GET contrat de A → 404', (await api('GET', `/billing/contracts/${contractId}`, tokenB)).status === 404);
    ok('B : GET facture de A → 404', (await api('GET', `/billing/invoices/${invoiceAId}`, tokenB)).status === 404);
    ok('B : GET caisses du site de A → 404', (await api('GET', `/billing/cash-registers?site_id=${A.site}`, tokenB)).status === 404);
    ok('B : GET paiements ne contient rien de A', (await api('GET', '/billing/payments', tokenB)).body.length === 0);

    // ── 2. B ne crée rien pour l'enfant de A ────────────────────────────────
    console.log('\n2) B ne crée pas pour l’enfant de A');
    const bCreateContract = await api('POST', '/billing/contracts', tokenB, {
      child_id: childA.rows[0].id, monthly_base_amount: 10000, start_date: '2026-01-01',
    });
    ok('B : création de contrat pour l’enfant de A → 404', bCreateContract.status === 404);
    const bCreateInvoice = await api('POST', '/billing/invoices/generate', tokenB, {
      contract_id: contractId, period_year: periodYear, period_month: periodMonth, due_date: '2026-08-05',
    });
    ok('B : génération de facture sur le contrat de A → 404', bCreateInvoice.status === 404);

    // ── 3. Idempotence mensuelle ────────────────────────────────────────────
    console.log('\n3) Génération mensuelle idempotente');
    const second = await api('POST', '/billing/invoices/generate', tokenA, {
      contract_id: contractId, period_year: periodYear, period_month: periodMonth, due_date: '2026-08-05',
    });
    ok('A : seconde génération → 409 INVOICE_ALREADY_EXISTS', second.status === 409 && second.body.code === 'INVOICE_ALREADY_EXISTS');
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE contract_id=$1 AND period_year=$2 AND period_month=$3`, [contractId, periodYear, periodMonth]);
    ok('Une seule facture en base pour contrat/période', count.rows[0].n === 1, `n=${count.rows[0].n}`);

    // ── Caisse ouverte ──────────────────────────────────────────────────────
    await api('POST', '/billing/cash-register/open', tokenA, { site_id: A.site, opening_balance: 0 });

    // ── 4. Paiement partiel ─────────────────────────────────────────────────
    console.log('\n4) Paiement espèces partiel');
    const pay1 = await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceAId, amount: 3000 });
    ok('Paiement partiel 3000 → solde 7000, statut partially_paid', pay1.status === 201 && Number(pay1.body.invoice.balance) === 7000 && pay1.body.invoice.status === 'partially_paid', JSON.stringify(pay1.body));

    // ── 5. Paiement > solde ─────────────────────────────────────────────────
    console.log('\n5) Paiement supérieur au solde');
    const over = await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceAId, amount: 99999 });
    ok('Paiement 99999 > solde → 422 PAYMENT_EXCEEDS_BALANCE', over.status === 422 && over.body.code === 'PAYMENT_EXCEEDS_BALANCE');

    // ── 6/7. Allocations bornées (base PostgreSQL) ──────────────────────────
    console.log('\n6-7) Allocations bornées par la base');
    const pay2 = (await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceAId, amount: 5000 })).body;
    const allocOverPayment = await api('POST', `/billing/payments/${pay2.id}/allocate`, tokenA, { invoice_id: invoiceAId, amount_allocated: 9000 });
    ok('Allocation 9000 > paiement 5000 → 422 PAYMENT_ALLOCATION_EXCEEDS_PAYMENT', allocOverPayment.status === 422 && allocOverPayment.body.code === 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT', JSON.stringify(allocOverPayment.body).slice(0, 100));
    // Facture FC (septembre) fraîche pour le cas « allocation > solde »
    const invoiceFC = await api('POST', '/billing/invoices/generate', tokenA, {
      contract_id: contractId, period_year: periodYear, period_month: 9, due_date: '2026-10-05',
    });
    const invoiceCId = invoiceFC.body.id;
    const pay3 = (await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceCId, amount: 8000 })).body;
    ok('Paiement 8000 sur facture fraîche → solde 2000', Number(pay3.invoice?.balance) === 2000, JSON.stringify(pay3).slice(0, 120));
    // Paiement Px partiellement alloué (1000/10000) → l'allocation API de 9000
    // dépasse le solde facture (2000) sans dépasser le paiement.
    const appConn0 = new pg.Client({ connectionString: appUrl() });
    await appConn0.connect();
    let pxId = null;
    try {
      await appConn0.query('BEGIN');
      await appConn0.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.org]);
      const seq = (await appConn0.query(`SELECT next_org_sequence($1) AS n`, [A.org])).rows[0].n;
      const px = await appConn0.query(
        `INSERT INTO payments(organization_id,reference_number,receipt_number,child_id,amount,method,status,confirmed_at,created_by)
         VALUES($1,$2,$3,$4,10000,'bank_transfer','confirmed',NOW(),$5) RETURNING id`,
        [A.org, `PAY-SQL-${seq}`, `REC-SQL-${seq}`, childA.rows[0].id, A.director],
      );
      pxId = px.rows[0].id;
      await appConn0.query(
        `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
         VALUES($1,$2,$3,1000,$4)`, [A.org, pxId, invoiceCId, A.director],
      );
      await appConn0.query('COMMIT');
    } finally {
      await appConn0.end();
    }
    const allocOverInvoice = await api('POST', `/billing/payments/${pxId}/allocate`, tokenA, { invoice_id: invoiceCId, amount_allocated: 9000 });
    ok('Allocation 9000 > solde 2000 (paiement 10000) → 422 PAYMENT_ALLOCATION_EXCEEDS_INVOICE', allocOverInvoice.status === 422 && allocOverInvoice.body.code === 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE', JSON.stringify(allocOverInvoice.body).slice(0, 100));

    // Refus en SQL direct sous NOBYPASSRLS (trigger 023) — transactions séparées
    const appConn = new pg.Client({ connectionString: appUrl() });
    await appConn.connect();
    try {
      // a) allocation > montant du paiement
      await appConn.query('BEGIN');
      await appConn.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.org]);
      const sqlOverPayment = await appConn.query(
        `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
         VALUES($1,$2,$3,6000,$4)`, [A.org, pay2.id, invoiceAId, A.director],
      ).then(() => true).catch((e) => e.message);
      ok('SQL direct : allocation > paiement refusée par la base', sqlOverPayment !== true && sqlOverPayment.includes('PAYMENT_ALLOCATION_EXCEEDS_PAYMENT'), String(sqlOverPayment).slice(0, 120));
      await appConn.query('ROLLBACK');

      // b) allocation > solde facture (paiement Px partiellement alloué :
      //    1000 déjà alloués, 9000 tentés → bornes paiement OK, solde dépassé)
      await appConn.query('BEGIN');
      await appConn.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.org]);
      const sqlOverInvoice = await appConn.query(
        `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
         VALUES($1,$2,$3,9000,$4)`, [A.org, pxId, invoiceCId, A.director],
      ).then(() => true).catch((e) => e.message);
      ok('SQL direct : allocation > solde facture refusée par la base', sqlOverInvoice !== true && sqlOverInvoice.includes('PAYMENT_ALLOCATION_EXCEEDS_INVOICE'), String(sqlOverInvoice).slice(0, 120));
      await appConn.query('ROLLBACK');
    } finally {
      await appConn.end();
    }

    // ── 8. Facture payée immuable ───────────────────────────────────────────
    console.log('\n8) Facture payée immuable');
    const pay4 = await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceAId, amount: 2000 });
    ok('Dernier paiement 2000 → facture payée', pay4.status === 201 && pay4.body.invoice.status === 'paid' && Number(pay4.body.invoice.balance) === 0);
    const payOnPaid = await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invoiceAId, amount: 100 });
    ok('Paiement sur facture payée → 422 INVOICE_IMMUTABLE', payOnPaid.status === 422 && payOnPaid.body.code === 'INVOICE_IMMUTABLE');
    const sqlImmutable = await db.query(`UPDATE invoices SET paid_amount=0 WHERE id=$1`, [invoiceAId]).then(() => true).catch((e) => e.message);
    ok('SQL direct : facture payée non modifiable (trigger C04)', sqlImmutable !== true && sqlImmutable.includes('INVOICE_IMMUTABLE'), String(sqlImmutable).slice(0, 120));

    // ── 9. Webhook signé, répété 3× = 1 paiement ────────────────────────────
    console.log('\n9) Webhook de paiement (signé, idempotent)');
    const invoiceFB = await api('POST', '/billing/invoices/generate', tokenA, {
      contract_id: contractId, period_year: periodYear, period_month: 8, due_date: '2026-09-05',
    });
    ok('A génère une seconde facture (août)', invoiceFB.status === 201);
    const invoiceBId = invoiceFB.body.id;
    const extRef = `ext-${tag}`;
    const webhookBody = JSON.stringify({ external_reference: extRef, invoice_id: invoiceBId, amount: 2000, gateway: 'edahabia' });
    const sign = (body) => createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(body).digest('hex');
    let webhookStatus = 0;
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(base + '/billing/webhooks/payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-payment-signature': sign(webhookBody) },
        body: webhookBody,
      });
      webhookStatus = r.status;
      await r.json();
    }
    ok('Webhook accepté 3 fois (200)', webhookStatus === 200, `status=${webhookStatus}`);
    const extCount = await db.query(`SELECT COUNT(*)::int AS n FROM payments WHERE external_reference=$1`, [extRef]);
    ok('Webhook ×3 = UN seul paiement', extCount.rows[0].n === 1, `n=${extCount.rows[0].n}`);
    const fbState = await db.query(`SELECT paid_amount, status FROM invoices WHERE id=$1`, [invoiceBId]);
    ok('Le paiement webhook est alloué à la facture', Number(fbState.rows[0].paid_amount) === 2000 && fbState.rows[0].status === 'partially_paid', JSON.stringify(fbState.rows[0]));
    const badSig = await fetch(base + '/billing/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-signature': 'deadbeef' },
      body: webhookBody,
    });
    ok('Signature invalide → 401 PAYMENT_WEBHOOK_SIGNATURE_INVALID', badSig.status === 401 && (await badSig.json()).code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID');
    const noSig = await fetch(base + '/billing/webhooks/payment', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: webhookBody,
    });
    ok('Signature manquante → 401', noSig.status === 401);

    // ── 10/11/12. Caisse : double ouverture, total, double clôture ──────────
    console.log('\n10-12) Caisse quotidienne');
    const reopen = await api('POST', '/billing/cash-register/open', tokenA, { site_id: A.site });
    ok('Double ouverture → 409 CASH_REGISTER_ALREADY_OPEN', reopen.status === 409 && reopen.body.code === 'CASH_REGISTER_ALREADY_OPEN');
    const close1 = await api('POST', '/billing/cash-register/close', tokenA, { site_id: A.site });
    ok('Clôture → 200', close1.status === 201 || close1.status === 200, JSON.stringify(close1.body).slice(0, 120));
    ok('Total caisse = somme exacte des espèces confirmés (18000)', close1.status < 300 && Number(close1.body.total_cash_in) === 18000, `total=${close1.body.total_cash_in}`);
    const close2 = await api('POST', '/billing/cash-register/close', tokenA, { site_id: A.site });
    ok('Double clôture → 409 CASH_REGISTER_CLOSED', close2.status === 409 && close2.body.code === 'CASH_REGISTER_CLOSED');
    const cashSum = await db.query(
      `SELECT COALESCE(SUM(p.amount),0)::numeric AS total FROM payments p JOIN children ch ON ch.id=p.child_id
       WHERE p.organization_id=$1 AND p.method='cash' AND p.status='confirmed' AND ch.site_id=$2`,
      [A.org, A.site],
    );
    ok('Total caisse == somme SQL des paiements espèces confirmés', Number(cashSum.rows[0].total) === 18000, `sql=${cashSum.rows[0].total}`);

    // ── 13/14. Worker : job PDF → stockage → URL autorisée ──────────────────
    console.log('\n13-14) PDF généré par le worker et servi');
    const jobsBefore = await db.query(
      `SELECT COUNT(*)::int AS n FROM background_jobs WHERE organization_id=$1 AND job_type='generate_invoice_pdf' AND status='pending'`,
      [A.org],
    );
    ok('Job PDF créé à la génération de chaque facture', jobsBefore.rows[0].n >= 3, `n=${jobsBefore.rows[0].n}`);
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl() },
      stdio: 'ignore',
    });
    const processed = await waitFor(async () => {
      const r = await db.query(
        `SELECT COUNT(*)::int AS done FROM background_jobs WHERE organization_id=$1 AND job_type='generate_invoice_pdf' AND status='done'`,
        [A.org],
      );
      return r.rows[0].done >= 3;
    }, 'Worker : jobs generate_invoice_pdf traités (done)');
    ok('Worker (NOBYPASSRLS) traite les jobs PDF', processed);
    const pdfState = await db.query(`SELECT pdf_url FROM invoices WHERE id=$1`, [invoiceAId]);
    ok('pdf_url renseigné sur la facture', Boolean(pdfState.rows[0].pdf_url), JSON.stringify(pdfState.rows[0]));
    const pdfFile = join(pdfDir, pdfState.rows[0].pdf_url);
    const fs = await import('node:fs');
    ok('PDF stocké sur le backend local configuré', fs.existsSync(pdfFile) && fs.statSync(pdfFile).size > 500, pdfFile);

    const pdfA = await fetch(base + `/billing/invoices/${invoiceAId}/pdf`, { headers: { authorization: `Bearer ${tokenA}` } });
    const pdfBytes = Buffer.from(await pdfA.arrayBuffer());
    ok('Directeur A : PDF facture servi (200, application/pdf, %PDF)', pdfA.status === 200 && (pdfA.headers.get('content-type') ?? '').includes('application/pdf') && pdfBytes.subarray(0, 5).toString() === '%PDF-', `status=${pdfA.status}`);
    const pdfB = await fetch(base + `/billing/invoices/${invoiceAId}/pdf`, { headers: { authorization: `Bearer ${tokenB}` } });
    ok('Directeur B : PDF de la facture de A → 404', pdfB.status === 404);
    const pdfParentA = await fetch(base + `/parent/invoices/${invoiceAId}/pdf`, { headers: { authorization: `Bearer ${tokenParentA}` } });
    const pdfParentBytes = Buffer.from(await pdfParentA.arrayBuffer());
    ok('Parent A : PDF de son enfant servi (200, %PDF)', pdfParentA.status === 200 && pdfParentBytes.subarray(0, 5).toString() === '%PDF-', `status=${pdfParentA.status}`);
    const pdfParentB = await fetch(base + `/parent/invoices/${invoiceAId}/pdf`, { headers: { authorization: `Bearer ${tokenParentB}` } });
    ok('Parent B (org B) : PDF de A → 404', pdfParentB.status === 404);

    // ── 15/16. Accès parent : ses seules factures et reçus ─────────────────
    console.log('\n15-16) Accès parent lecture seule');
    const parentInvoices = await api('GET', '/parent/invoices', tokenParentA);
    const ids = parentInvoices.body.map((i) => i.id);
    ok('Parent A : factures de SES enfants uniquement (3)', parentInvoices.status === 200 && ids.includes(invoiceAId) && ids.includes(invoiceBId) && ids.includes(invoiceCId) && ids.length === 3, JSON.stringify(ids));
    const detailParent = await api('GET', `/parent/invoices/${invoiceAId}`, tokenParentA);
    ok('Parent A : détail facture avec lignes', detailParent.status === 200 && Array.isArray(detailParent.body.lines) && detailParent.body.lines.length >= 1);
    const parentBInvoices = await api('GET', '/parent/invoices', tokenParentB);
    ok('Parent B (org B) : aucune facture de A dans sa liste', parentBInvoices.status === 200 && parentBInvoices.body.length === 0);
    ok('Parent B : GET facture de A → 404', (await api('GET', `/parent/invoices/${invoiceAId}`, tokenParentB)).status === 404);
    const parentReceipts = await api('GET', '/parent/receipts', tokenParentA);
    ok('Parent A : reçus des paiements de ses enfants', parentReceipts.status === 200 && parentReceipts.body.length >= 4 && parentReceipts.body.every((r) => r.receipt_number), `n=${parentReceipts.body.length}`);
    ok('Parent A : détail reçu', (await api('GET', `/parent/receipts/${pay2.id}`, tokenParentA)).status === 200);
    ok('Parent B : reçu de A → 404', (await api('GET', `/parent/receipts/${pay2.id}`, tokenParentB)).status === 404);
    const payDetail = await api('GET', `/billing/payments/${pay2.id}`, tokenA);
    ok('Directeur A : détail paiement + reçu + allocations', payDetail.status === 200 && payDetail.body.receipt_number && Array.isArray(payDetail.body.allocations) && payDetail.body.allocations.length === 1);
  } finally {
    if (worker) worker.kill();
    // ── Nettoyage (ordre dépendant des FK) — même pattern que phase4-6 ─────
    try {
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM daily_cash_registers WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM sync_operations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM sync_cursors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM media_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM media_assets WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM notification_queue WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM notification_inbox WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM consent_records WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p8-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p8-%')`);
      await db.query(`DELETE FROM devices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p8-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p8-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p8-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase8 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 8 : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 8 validée : facturation isolée (16 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
