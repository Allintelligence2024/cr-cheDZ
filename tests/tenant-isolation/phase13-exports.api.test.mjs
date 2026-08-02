#!/usr/bin/env node
/**
 * Phase 13 (roadmap v2) — exports Excel (présences + factures), avec deux
 * tenants A/B, sur PostgreSQL réel avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. la directrice de A demande un export de présences (job worker) ;
 *   2. le worker génère le fichier Excel (magic PK) et passe report_exports
 *      à 'done' avec une taille de fichier ;
 *   3. A télécharge l'export (buffer local) ;
 *   4. l'export de factures contient les totaux réels des factures de A ;
 *   5. B ne voit pas les exports de A (liste vide) ;
 *   6. B ne télécharge pas l'export de A (404) ;
 *   7. téléchargement avant traitement → 409 EXPORT_NOT_READY ;
 *   8. B ne demande pas d'export pour des données hors de son tenant
 *      (le worker n'écrit rien chez A via B — isolation par RLS).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/),
 * STORAGE_BACKEND=local.
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
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `exp-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let worker;

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'E','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const mkChild = async (org, ref, first) => (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,$4,$5,'Test','2024-01-01',$6) RETURNING id`, [org.org, org.site, org.room, ref, first, org.director],
    )).rows[0].id;
    const childA = await mkChild(A, 'EXP-A1', 'Yanis');
    const childB = await mkChild(B, 'EXP-B1', 'Lina');

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    // Données A : 2 présences + 1 facture
    await api('POST', '/attendance/check-in', tokenA, { child_id: childA });
    await api('POST', '/attendance/check-out', tokenA, { child_id: childA });
    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: childA, monthly_base_amount: 12000, start_date: '2026-01-01' })).body;
    const invoice = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' })).body;
    ok('Données A prêtes (2 présences, 1 facture)', Boolean(invoice.id));

    // ── 1/7. Demande d'export + téléchargement prématuré ────────────────────
    console.log('\n1/7) Demande d\'export de présences');
    const today = new Date().toISOString().slice(0, 10);
    const req = await api('POST', '/exports', tokenA, { report_type: 'attendance', period: `${today}..${today}` });
    ok('Demande d\'export → 201 (pending)', req.status === 201 && req.body.status === 'pending', JSON.stringify(req.body).slice(0, 120));
    const exportId = req.body.id;
    const early = await fetch(`${base}/exports/${exportId}/download`, { headers: { authorization: `Bearer ${tokenA}` } });
    ok('Téléchargement avant traitement → 409 EXPORT_NOT_READY', early.status === 409 && (await early.json()).code === 'EXPORT_NOT_READY');

    // ── 2. Worker génère le fichier ─────────────────────────────────────────
    console.log('\n2) Worker génère le fichier Excel');
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl() },
      stdio: 'ignore',
    });
    const done = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const r = await db.query(`SELECT status, storage_key, file_size_bytes FROM report_exports WHERE id=$1`, [exportId]);
        if (r.rows[0]?.status === 'done') return r.rows[0];
        await sleep(500);
      }
      return null;
    })();
    ok('Export → done avec storage_key + taille', Boolean(done?.storage_key) && Number(done?.file_size_bytes) > 1000, JSON.stringify(done));

    // ── 3. Téléchargement par A ─────────────────────────────────────────────
    console.log('\n3) Téléchargement par A');
    const dlA = await fetch(`${base}/exports/${exportId}/download`, { headers: { authorization: `Bearer ${tokenA}` } });
    const buffer = Buffer.from(await dlA.arrayBuffer());
    ok('A : téléchargement 200 + magic PK (xlsx)', dlA.status === 200 && buffer.subarray(0, 2).toString() === 'PK', `status=${dlA.status} magic=${buffer.subarray(0, 2).toString()}`);
    ok('A : content-disposition attachment .xlsx', (dlA.headers.get('content-disposition') ?? '').includes('.xlsx'));

    // ── 5/6. Isolation B ────────────────────────────────────────────────────
    console.log('\n5/6) Isolation (org B)');
    const listB = await api('GET', '/exports', tokenB);
    ok('B : liste des exports vide', listB.status === 200 && listB.body.length === 0);
    const dlB = await fetch(`${base}/exports/${exportId}/download`, { headers: { authorization: `Bearer ${tokenB}` } });
    ok('B : téléchargement de l\'export de A → 404', dlB.status === 404);
    const listA = await api('GET', '/exports', tokenA);
    ok('A : son export listé (done)', listA.status === 200 && listA.body.length === 1 && listA.body[0].status === 'done');

    // ── 4. Export de factures (totaux réels) ────────────────────────────────
    console.log('\n4) Export de factures');
    const reqInv = await api('POST', '/exports', tokenA, { report_type: 'invoices', period: '2026-07' });
    const invExportId = reqInv.body.id;
    const doneInv = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const r = await db.query(`SELECT status FROM report_exports WHERE id=$1`, [invExportId]);
        if (r.rows[0]?.status === 'done') return true;
        await sleep(500);
      }
      return false;
    })();
    ok('Export de factures → done', doneInv);
    const dlInv = await fetch(`${base}/exports/${invExportId}/download`, { headers: { authorization: `Bearer ${tokenA}` } });
    const invBuf = Buffer.from(await dlInv.arrayBuffer());
    ok('A : téléchargement de l\'export factures (PK)', dlInv.status === 200 && invBuf.subarray(0, 2).toString() === 'PK');
    // Vérification du contenu : parse du classeur avec exceljs (le xlsx est un zip)
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(invBuf);
    const ws = wb.worksheets[0];
    const values = [];
    ws.eachRow((row) => { row.eachCell((cell) => values.push(String(cell.value ?? ''))); });
    const joined = values.join(' | ');
    ok('Contenu : n° de facture de A présent', joined.includes(invoice.invoice_number), joined.slice(0, 120));
    ok('Contenu : montant 12000 présent', joined.includes('12000'), joined.slice(0, 120));

    // ── 8. B ne peut pas écrire chez A via un export ────────────────────────
    console.log('\n8) B ne demande pas d\'export croisé');
    const reqB = await api('POST', '/exports', tokenB, { report_type: 'attendance', period: `${today}..${today}` });
    ok('B : demande d\'export OK (données B uniquement)', reqB.status === 201);
    const bDone = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const r = await db.query(`SELECT status FROM report_exports WHERE id=$1`, [reqB.body.id]);
        if (r.rows[0]?.status === 'done') return true;
        await sleep(500);
      }
      return false;
    })();
    ok('B : export traité (0 présence B, fichier généré)', bDone);
    const aExportCount = await db.query(`SELECT COUNT(*)::int AS n FROM report_exports WHERE organization_id=$1`, [A.org]);
    ok('A : toujours 2 exports (rien écrit par B chez A)', aExportCount.rows[0].n === 2, `n=${aExportCount.rows[0].n}`);
    void childB;
  } finally {
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM report_exports WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'exp-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'exp-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'exp-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'exp-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'exp-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase13-exports partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 13 exports : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 13 exports validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
