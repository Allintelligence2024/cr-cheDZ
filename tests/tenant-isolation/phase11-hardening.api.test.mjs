#!/usr/bin/env node
/**
 * Phase 11 GATE — durcissement (métriques, rétention, idempotence mensuelle
 * worker), sur PostgreSQL réel avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. GET /metrics public : format Prometheus, compteurs HTTP, métriques
 *      métier (jobs, notifications, factures impayées), AUCUNE donnée tenant ;
 *   2. rétention : lignes de logs > 5 ans purgées par le worker (job
 *      retention_purge), lignes récentes conservées — y compris
 *      media_access_logs (RLS, fonction SECURITY DEFINER 034) ;
 *   3. send_monthly_invoices : 2 contrats actifs + 1 inactif → 2 factures
 *      avec lignes ; seconde exécution → 0 nouvelle facture (idempotence) ;
 *   4. index Phase 11 présents en base (033).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/).
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
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? '/tmp/pgtest/pdfstore';
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  const tag = `p11-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let worker;

  try {
    // ── 1. /metrics ─────────────────────────────────────────────────────────
    console.log('\n1) /metrics (Prometheus, sans PII)');
    // Une requête préalable (comptée par le middleware) puis DEUX scrapes :
    // le compteur d'une requête n'est incrémenté qu'au finish de celle-ci,
    // donc la requête /metrics n'apparaît qu'au scrape suivant.
    await fetch(`${base}/health`).catch(() => undefined);
    const metricsRes1 = await fetch(`${base}/metrics`);
    const metricsText1 = await metricsRes1.text();
    ok('/metrics → 200 text/plain', metricsRes1.status === 200 && (metricsRes1.headers.get('content-type') ?? '').includes('text/plain'), `status=${metricsRes1.status}`);
    const metricsRes2 = await fetch(`${base}/metrics`);
    const metricsText = await metricsRes2.text();
    ok('Compteur http_requests_total présent (dont /health et /metrics)', metricsText.includes('http_requests_total{method="GET",route="/api/v1/health"') && metricsText.includes('http_requests_total{method="GET",route="/api/v1/metrics"'), metricsText.split('\n').filter((l) => l.startsWith('http_requests_total')).slice(0, 3).join(' | '));
    void metricsText1;
    ok('Métriques métier présentes (jobs, notifications, factures)', metricsText.includes('creche_jobs_pending') && metricsText.includes('creche_notifications_pending') && metricsText.includes('creche_invoices_unpaid'));
    ok('process_uptime_seconds présent', metricsText.includes('process_uptime_seconds'));
    ok('AUCUNE donnée tenant exposée (ni email, ni id enfant)', !metricsText.includes('@') && !metricsText.includes(tag));

    // ── 2. Rétention ────────────────────────────────────────────────────────
    console.log('\n2) Rétention (purge > 5 ans)');
    const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H','31') RETURNING id`, [tag]);
    const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
    const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
    const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${tag}-director@test.dz`, hash]);
    const child = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P11-1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [org.rows[0].id, site.rows[0].id, room.rows[0].id, director.rows[0].id],
    );
    // Lignes vieilles (6 ans) + récentes dans les 3 journaux
    await db.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, occurred_at) VALUES
       ($1,$2,'login','user', NOW() - INTERVAL '6 years'),
       ($1,$2,'login','user', NOW())`,
      [org.rows[0].id, director.rows[0].id],
    );
    await db.query(
      `INSERT INTO data_access_logs (organization_id, user_id, data_type, data_subject_id, data_subject_type, access_type, accessed_at) VALUES
       ($1,$2,'child_record',$3,'child','read', NOW() - INTERVAL '6 years'),
       ($1,$2,'child_record',$3,'child','read', NOW())`,
      [org.rows[0].id, director.rows[0].id, child.rows[0].id],
    );
    await db.query(
      `INSERT INTO media_assets (organization_id, child_id, uploaded_by, media_type, storage_key, mime_type, exif_stripped) VALUES
       ($1,$2,$3,'photo','p11/old.jpg','image/jpeg',true) RETURNING id`,
      [org.rows[0].id, child.rows[0].id, director.rows[0].id],
    );
    const mediaId = (await db.query(
      `INSERT INTO media_assets (organization_id, child_id, uploaded_by, media_type, storage_key, mime_type, exif_stripped) VALUES
       ($1,$2,$3,'photo','p11/new.jpg','image/jpeg',true) RETURNING id`,
      [org.rows[0].id, child.rows[0].id, director.rows[0].id],
    )).rows[0].id;
    await db.query(
      `INSERT INTO media_access_logs (media_id, organization_id, accessed_by, access_type, accessed_at) VALUES
       ($1,$2,$3,'view', NOW() - INTERVAL '6 years')`,
      [mediaId, org.rows[0].id, director.rows[0].id],
    );

    await db.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'retention_purge', '{}', 1)`,
    );
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl(), RETENTION_DAYS: '1825' },
      stdio: 'ignore',
    });
    const purged = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const r = await db.query(
          `SELECT COUNT(*)::int AS n FROM audit_logs WHERE occurred_at < NOW() - INTERVAL '5 years'`,
        );
        if (r.rows[0].n === 0) return true;
        await sleep(500);
      }
      return false;
    })();
    ok('Worker : purge des journaux > 5 ans (job retention_purge)', purged);
    const oldAudit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE occurred_at < NOW() - INTERVAL '5 years'`);
    ok('audit_logs : aucune ligne > 5 ans restante', oldAudit.rows[0].n === 0);
    const recentAudit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE occurred_at >= NOW() - INTERVAL '1 day'`);
    ok('audit_logs : lignes récentes conservées', recentAudit.rows[0].n >= 1);
    const oldData = await db.query(`SELECT COUNT(*)::int AS n FROM data_access_logs WHERE accessed_at < NOW() - INTERVAL '5 years'`);
    ok('data_access_logs : purgé', oldData.rows[0].n === 0);
    const oldMedia = await db.query(`SELECT COUNT(*)::int AS n FROM media_access_logs WHERE accessed_at < NOW() - INTERVAL '5 years'`);
    ok('media_access_logs (RLS) : purgé via SECURITY DEFINER', oldMedia.rows[0].n === 0);
    const jobState = await db.query(`SELECT status FROM background_jobs WHERE job_type='retention_purge'`);
    ok('Job retention_purge → done', jobState.rows[0]?.status === 'done', JSON.stringify(jobState.rows));

    // ── 3. send_monthly_invoices (idempotent) ───────────────────────────────
    console.log('\n3) Génération mensuelle par le worker (idempotente)');
    const mkContract = async (active) => {
      const r = await db.query(
        `INSERT INTO contracts (organization_id, child_id, monthly_base_amount, start_date, is_active, created_by, includes_meals, meal_amount)
         VALUES ($1,$2,$3,'2026-01-01',$4,$5,true,2500) RETURNING id`,
        [org.rows[0].id, child.rows[0].id, 10000, active, director.rows[0].id],
      );
      return r.rows[0].id;
    };
    const cActive1 = await mkContract(true);
    const cActive2 = await mkContract(true);
    const cInactive = await mkContract(false);
    await db.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES ($1, 'send_monthly_invoices', $2, 1)`,
      [org.rows[0].id, JSON.stringify({ period_year: 2026, period_month: 7, due_date: '2026-08-05' })],
    );
    const waitInvoices = async (expected) => {
      for (let i = 0; i < 60; i += 1) {
        const r = await db.query(
          `SELECT COUNT(*)::int AS n FROM invoices WHERE organization_id=$1 AND period_year=2026 AND period_month=7`,
          [org.rows[0].id],
        );
        if (r.rows[0].n === expected) return r.rows[0].n;
        await sleep(500);
      }
      return -1;
    };
    const n1 = await waitInvoices(2);
    ok('Worker : 2 factures créées pour 2 contrats actifs (inactif exclu)', n1 === 2, `n=${n1}`);
    const lines = await db.query(
      `SELECT COUNT(*)::int AS n FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id=$1 AND period_year=2026 AND period_month=7)`,
      [org.rows[0].id],
    );
    ok('Chaque facture a ses lignes (garde + repas)', lines.rows[0].n === 4, `n=${lines.rows[0].n}`);
    const totals = await db.query(
      `SELECT total_amount FROM invoices WHERE organization_id=$1 AND period_year=2026 AND period_month=7 ORDER BY total_amount`,
      [org.rows[0].id],
    );
    ok('Total = base 10000 + repas 2500 = 12500', totals.rows.every((r) => Number(r.total_amount) === 12500), JSON.stringify(totals.rows));
    // Idempotence : relance du même job
    await db.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES ($1, 'send_monthly_invoices', $2, 1)`,
      [org.rows[0].id, JSON.stringify({ period_year: 2026, period_month: 7, due_date: '2026-08-05' })],
    );
    const n2 = await waitInvoices(2);
    await sleep(4000);
    const n2b = await db.query(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE organization_id=$1 AND period_year=2026 AND period_month=7`,
      [org.rows[0].id],
    );
    ok('Seconde exécution → toujours 2 factures (idempotence)', n2b.rows[0].n === 2 && n2 === 2, `n=${n2b.rows[0].n}`);
    void cInactive;

    // ── 4. Index Phase 11 présents ──────────────────────────────────────────
    console.log('\n4) Index Phase 11 (migration 033/034)');
    const indexNames = ['idx_guardians_user', 'idx_daily_events_feed', 'idx_notif_inbox_user_org', 'idx_contracts_org', 'idx_payments_cash_daily', 'idx_payment_alloc_payment', 'idx_daily_events_incidents', 'idx_media_access_accessed'];
    for (const idx of indexNames) {
      const r = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname=$1`, [idx]);
      ok(`Index ${idx} présent`, r.rows.length === 1);
    }
    void cActive1; void cActive2;
  } finally {
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM media_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM media_assets WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%') OR job_type='retention_purge'`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p11-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p11-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p11-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p11-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p11-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase11 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 11 : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 11 validée : métriques, rétention, idempotence mensuelle (4 volets) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
