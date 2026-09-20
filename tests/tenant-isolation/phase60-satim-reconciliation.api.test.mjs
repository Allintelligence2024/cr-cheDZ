#!/usr/bin/env node
/**
 * Phase 60 GATE — P1-1 : cycle de paiement en ligne complet contre le
 * SIMULATEUR de passerelle (scripts/satim-sandbox-server.mjs, même contrat que
 * SATIM : init signé + rappel webhook signé) piloté par le script de preuve
 * scripts/satim-sandbox-proof.mjs (celui qui sera rejoué contre la sandbox
 * SATIM réelle), puis journal de rapprochement.
 *
 *   1. le simulateur démarre (processus réel), l'API pointe dessus ;
 *   2. scripts/satim-sandbox-proof.mjs (SIMULATE_WEBHOOK=1) : init réel →
 *      webhook signé → facture payée → rapprochement confirmé (exit 0) ;
 *   3. la page /pay du simulateur + /confirm déclenchent un webhook réel vers
 *      l'API pour une 2e facture (parcours « navigateur ») → paid ;
 *   4. rapprochement : pending récent (init sans webhook), pending en
 *      souffrance (created_at reculé > stale), échoué (passerelle KO), totaux
 *      cohérents ; from/to ; stale_minutes invalide → 400 ;
 *   5. isolation : B ne voit aucun paiement de A ; parent → 403.
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => { console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`); if (!v) failures.push(n); };

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);

  const satimSecret = `satim-${randomUUID()}`;
  const webhookSecret = `webhook-secret-${randomUUID()}-${randomUUID()}`;
  const sandboxPort = 4600 + Math.floor(Math.random() * 300);
  Object.assign(process.env, {
    DATABASE_URL: appUrl(), RATE_LIMIT_DISABLED: 'true', NODE_ENV: 'test', SENTRY_DSN: '',
    SATIM_MERCHANT_ID: 'merchant-sandbox', SATIM_SECRET: satimSecret, SATIM_GATEWAY_URL: `http://127.0.0.1:${sandboxPort}`,
    PAYMENT_WEBHOOK_SECRET: webhookSecret,
  });
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const apiPort = app.getHttpServer().address().port;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const base = `${apiUrl}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  // Simulateur de passerelle : processus réel.
  const sandbox = spawn(process.execPath, ['scripts/satim-sandbox-server.mjs'], {
    cwd: repo, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, SATIM_SECRET: satimSecret, PAYMENT_WEBHOOK_SECRET: webhookSecret, API_URL: apiUrl, SATIM_SANDBOX_PORT: String(sandboxPort) },
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('simulateur SATIM non démarré')), 10000);
    sandbox.stdout.on('data', (d) => { if (String(d).includes('simulateur sur')) { clearTimeout(t); resolve(); } });
  });
  ok('Simulateur de passerelle démarré (processus réel)', true);

  const tag = `p60-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 4);
  const cleanupOrgs = `(SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`;

  try {
    const role = async (slug) => (await db.query(`SELECT id FROM roles WHERE slug=$1`, [slug])).rows[0].id;
    const mkUser = async (email, orgId, slug) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u, await role(slug)]);
      return u;
    };
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = await mkUser(`${slug}-director@test.dz`, org, 'director');
      await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [org]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const child = (await db.query(`INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,'P60','Yanis','Test','2024-01-01',$4) RETURNING id`, [A.org, A.site, A.room, A.director])).rows[0].id;
    const parent = await mkUser(`${tag}-parent@test.dz`, A.org, 'parent_primary');
    void parent;
    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenP = (await api('POST', '/auth/login', null, { email: `${tag}-parent@test.dz`, password })).body.access_token;
    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: child, monthly_base_amount: 10000, start_date: '2026-01-01' })).body;
    const mkInvoice = async (month) => (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: month, due_date: '2026-12-05' })).body;
    const inv1 = await mkInvoice(1); const inv2 = await mkInvoice(2); const inv3 = await mkInvoice(3); const inv4 = await mkInvoice(4); const inv5 = await mkInvoice(5);
    ok('Contexte : 5 factures de 10000', [inv1, inv2, inv3, inv4, inv5].every((i) => i.id));

    console.log('\n2) Script de preuve (celui de la sandbox réelle) — webhook simulé');
    // Processus enfant asynchrone : l'API tourne dans CE processus, un execSync bloquerait la boucle d'événements (deadlock).
    const proof = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/satim-sandbox-proof.mjs'], {
        cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, API_URL: apiUrl, LOGIN_EMAIL: `${tag}-a-director@test.dz`, LOGIN_PASSWORD: password, INVOICE_ID: inv1.id, PAYMENT_WEBHOOK_SECRET: webhookSecret, SIMULATE_WEBHOOK: '1' },
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ code, out }));
    });
    ok('satim-sandbox-proof.mjs → exit 0 (init réel → webhook → payée → rapprochement)', proof.code === 0 && /P1-1 : cycle init/.test(proof.out), proof.out.slice(-400));
    const paid1 = await api('GET', `/billing/invoices/${inv1.id}`, tokenA);
    ok('Facture 1 réellement payée en base', paid1.body.status === 'paid' && Number(paid1.body.paid_amount) === 10000);

    console.log('\n3) Parcours « navigateur » : page /pay du simulateur → /confirm → webhook réel');
    const init2 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: inv2.id, method: 'edahabia' });
    ok('Init 2 → 201 avec redirect_url du simulateur', init2.status === 201 && init2.body.redirect_url.startsWith(`http://127.0.0.1:${sandboxPort}/pay?t=`), JSON.stringify(init2.body).slice(0, 200));
    const page = await fetch(init2.body.redirect_url);
    ok('Page de paiement servie (200, formulaire)', page.status === 200 && /Payer/.test(await page.text()));
    const confirm = await fetch(init2.body.redirect_url.replace('/pay?', '/confirm?'), { method: 'POST' });
    const confirmHtml = await confirm.text();
    ok('Clic « Payer » → le simulateur rappelle l’API : HTTP 200', confirm.status === 200 && /HTTP 200/.test(confirmHtml), confirmHtml.slice(0, 200));
    ok('Facture 2 payée via ce webhook réel', (await api('GET', `/billing/invoices/${inv2.id}`, tokenA)).body.status === 'paid');
    const replay = await fetch(init2.body.redirect_url.replace('/pay?', '/confirm?'), { method: 'POST' });
    ok('Rejeu du webhook (même référence) → idempotent, toujours 200, pas de double paiement', replay.status === 200 && (await db.query(`SELECT count(*)::int AS n FROM payments WHERE invoice_id=$1 AND status='confirmed'`, [inv2.id])).rows[0].n === 1);

    console.log('\n4) Rapprochement');
    const init3 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: inv3.id, method: 'cib' }); // pending récent
    const init4 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: inv4.id, method: 'cib' }); // pending → en souffrance
    await db.query(`UPDATE payments SET created_at = NOW() - interval '2 hours' WHERE external_reference=$1`, [init4.body.external_reference]);
    const saved = process.env.SATIM_GATEWAY_URL;
    process.env.SATIM_GATEWAY_URL = 'http://127.0.0.1:1'; // passerelle KO → failed
    const init5 = await api('POST', '/billing/payments/online', tokenA, { invoice_id: inv5.id, method: 'cib' });
    process.env.SATIM_GATEWAY_URL = saved;
    ok('Init 5 avec passerelle injoignable → 502, paiement failed', init5.status === 502);
    const rec = await api('GET', '/billing/payments/online/reconciliation?stale_minutes=30', tokenA);
    const t = rec.body.totals;
    ok('Totaux : 2 confirmés (20000), 1 pending récent, 1 en souffrance, 1 échoué', rec.status === 200 && t.confirmed.count === 2 && t.confirmed.amount === 20000 && t.pending.count === 1 && t.stale.count === 1 && t.failed.count === 1, JSON.stringify(t));
    const stale = rec.body.items.find((p) => p.external_reference === init4.body.external_reference);
    ok('Ligne en souffrance : stale=true, transaction_id du PSP présent, facture liée', stale && stale.stale === true && typeof stale.transaction_id === 'string' && stale.invoice_id === inv4.id, JSON.stringify(stale));
    const fresh = rec.body.items.find((p) => p.external_reference === init3.body.external_reference);
    ok('Pending récent : stale=false', fresh && fresh.stale === false);
    ok('stale_minutes=1 → le pending récent n’est pas encore en souffrance (créé à l’instant)', (await api('GET', '/billing/payments/online/reconciliation?stale_minutes=1', tokenA)).body.totals.stale.count === 1);
    ok('from dans le futur → aucune ligne', (await api('GET', '/billing/payments/online/reconciliation?from=2099-01-01', tokenA)).body.items.length === 0);
    ok('stale_minutes invalide → 400', (await api('GET', '/billing/payments/online/reconciliation?stale_minutes=abc', tokenA)).status === 400);
    ok('from mal formé → 400', (await api('GET', '/billing/payments/online/reconciliation?from=01/01/2026', tokenA)).status === 400);
    const invoicesAfter = await db.query(`SELECT status FROM invoices WHERE id = ANY($1::uuid[]) ORDER BY period_month`, [[inv3.id, inv4.id, inv5.id]]);
    ok('Aucun pending/failed n’a touché une facture (3 restent draft — jamais de faux payé)', invoicesAfter.rows.every((r) => r.status === 'draft'));

    console.log('\n5) Isolation');
    const recB = await api('GET', '/billing/payments/online/reconciliation', tokenB);
    ok('B : rapprochement vide', recB.status === 200 && recB.body.items.length === 0 && recB.body.totals.confirmed.count === 0);
    ok('Parent : rapprochement → 403', (await api('GET', '/billing/payments/online/reconciliation', tokenP)).status === 403);
  } finally {
    sandbox.kill();
    try {
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN ${cleanupOrgs} AND status='pending'`);
      for (const tbl of ['audit_logs', 'data_access_logs', 'sessions', 'devices']) await db.query(`DELETE FROM ${tbl} WHERE organization_id IN ${cleanupOrgs}`);
    } catch (e) { console.error('Nettoyage phase60 partiel :', e.message); }
    await app.close();
    await db.end();
  }
  if (failures.length) { console.error(`\nÉCHEC Phase 60 : ${failures.length} — ${failures.join(' | ')}`); process.exit(1); }
  console.log('\n✓ Phase 60 validée : cycle SATIM (simulateur au contrat réel) + rapprochement (P1-1) sur PostgreSQL réel NOBYPASSRLS.');
};
main().catch((e) => { console.error(e.stack); process.exit(1); });
