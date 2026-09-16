#!/usr/bin/env node
// E2–E6 : API + vrai worker + PostgreSQL ; fixtures synthétiques, base jetable.
import assert from 'node:assert/strict';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: adminUrl });
const root = mkdtempSync(join(tmpdir(), 'creche-e28-'));
let api, apiPool, base, token, org, user, child, site, appDb;
const workers = new Set();
async function waitFor(fn, label, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const value = await fn(); if (value) return value; await delay(40); }
  throw new Error(`Timeout: ${label}`);
}
function startWorker(extra = {}) {
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env: { ...process.env, DATABASE_URL: appUrl(), NODE_ENV: process.env.PRODUCTION_ROLE_TESTS === '1' ? 'production' : 'test',
      JWT_SECRET: 'phase28-worker-jwt-only-32-characters-long', PAYMENT_WEBHOOK_SECRET: 'phase28-worker-webhook-32-characters-long',
      // G5 : la garde production (partagée api/worker) exige la clé TOTP au boot ;
      // le worker ne l'utilise pas, mais le contrat de déploiement la fournit partout.
      TOTP_ENCRYPTION_KEY: 'e'.repeat(64),
      STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: root, SENTRY_DSN: '', FIREBASE_SERVICE_ACCOUNT_JSON: '',
      WORKER_SCHEDULER_ENABLED: 'false', WORKER_POLL_MS: '50', WORKER_SCHEDULER_POLL_MS: '100',
      WORKER_EXPORT_TIMEOUT_MS: '5000', WORKER_EXPORT_MAX_AGE_MS: '1800000', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, output: '', exited: false };
  child.stdout.on('data', b => { state.output += b; }); child.stderr.on('data', b => { state.output += b; });
  state.exit = new Promise(resolve => child.once('exit', (code, signal) => { state.exited = true; workers.delete(state); resolve({ code, signal }); }));
  workers.add(state); return state;
}
async function stop(state) { if (!state.exited) state.child.kill('SIGKILL'); await state.exit; }
async function request(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function exportRequest(period, type = 'attendance') {
  const r = await request('POST', '/exports', { report_type: type, period });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await db.query("UPDATE background_jobs SET max_attempts=1 WHERE payload->>'export_id'=$1", [r.body.id]);
  return r.body.id;
}
async function exportRow(id) { return (await db.query('SELECT * FROM report_exports WHERE id=$1', [id])).rows[0]; }
async function job(type, payload = {}, tenant = org) {
  return (await db.query(`INSERT INTO background_jobs(organization_id,job_type,payload,max_attempts,priority)
    VALUES($1,$2,$3,1,10) RETURNING id`, [tenant, type, JSON.stringify(payload)])).rows[0].id;
}
async function jobRow(id) { return (await db.query('SELECT * FROM background_jobs WHERE id=$1', [id])).rows[0]; }
async function settled(id) {
  return waitFor(async () => { const r = await jobRow(id); return ['done','failed'].includes(r.status) ? r : false; }, `job ${id}`);
}
async function contract(start = '2026-09-01', end = null, extras = false) {
  return (await db.query(`INSERT INTO contracts(organization_id,child_id,monthly_base_amount,start_date,end_date,created_by,
    includes_meals,meal_amount,includes_transport,transport_amount,discount_percent)
    VALUES($1,$2,10000,$3,$4,$5,$6,2500,$6,700,10) RETURNING id`, [org, child, start, end, user, extras])).rows[0].id;
}
function pdfText(buffer) {
  const raw = buffer.toString('latin1'); let text = '';
  const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(stream)) {
    try {
      const content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      for (const h of content.matchAll(/<([0-9a-f]+)>/gi)) text += Buffer.from(h[1], 'hex').toString('latin1');
    } catch { /* flux non Flate, image ou police : pas du texte de page */ }
  }
  return text;
}

before(async () => {
  execFileSync(process.execPath, ['scripts/migrate.mjs', '--reset'], { env: { ...process.env, DATABASE_URL: adminUrl, NODE_ENV: 'test' }, stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/seed.mjs'], { env: { ...process.env, DATABASE_URL: adminUrl, NODE_ENV: 'test' }, stdio: 'pipe' });
  await db.connect(); await ensureAppRole(db);
  appDb = new pg.Client({ connectionString: appUrl() }); await appDb.connect();
  org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES('phase28','Test E','31') RETURNING id")).rows[0].id;
  site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'Test') RETURNING id", [org])).rows[0].id;
  user = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES('e28@test.dz','Test','E',$1,'active') RETURNING id`, [await bcrypt.hash('Password123!', 4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'", [org, user]);
  child = (await db.query(`INSERT INTO children(organization_id,site_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
    VALUES($1,$2,'E28','Enfant','Test','2024-01-01',$3) RETURNING id`, [org,site,user])).rows[0].id;
  await db.query("INSERT INTO attendance_sessions(organization_id,site_id,child_id,session_date) VALUES($1,$2,$3,'2026-09-01')", [org,site,child]);
  await db.query(`INSERT INTO attendance_events(organization_id,session_id,child_id,event_type,occurred_at,recorded_by)
    SELECT $1,id,$2,'check_in','2026-09-01T07:00:00Z',$3 FROM attendance_sessions WHERE child_id=$2`,[org,child,user]);
  process.env.DATABASE_URL = appUrl(); process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.STORAGE_BACKEND = 'local'; process.env.STORAGE_LOCAL_DIR = root;
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  api = await createApp(); apiPool = api.get(PG_POOL); await api.listen(0);
  base = `http://127.0.0.1:${api.getHttpServer().address().port}/api/v1`;
  token = (await request('POST','/auth/login',{ email:'e28@test.dz',password:'Password123!' })).body.access_token;
  assert.ok(token);
});
beforeEach(async () => {
  await db.query('TRUNCATE background_jobs, notification_queue, report_exports CASCADE');
  await db.query('UPDATE contracts SET is_active=false');
  if ((await db.query("SELECT to_regclass('scheduler_ticks') AS t")).rows[0].t) await db.query('UPDATE scheduler_ticks SET next_run_at=scheduler_next_run(job_type,NOW()),created_at=NOW(),last_success_at=NULL,last_job_id=NULL');
});
afterEach(async () => { await Promise.all([...workers].map(stop)); });
after(async () => { if (api) await api.close(); if (apiPool) await apiPool.end(); if (appDb) await appDb.end(); await db.end(); });

test('E3 : notification sans device conserve le motif avec le statut contractuel sent', async () => {
  const id = (await db.query(`INSERT INTO notification_queue(organization_id,user_id,channel,body_fr) VALUES($1,$2,'push','Test') RETURNING id`, [org,user])).rows[0].id;
  startWorker();
  const row = await waitFor(async () => { const r=(await db.query('SELECT * FROM notification_queue WHERE id=$1',[id])).rows[0]; return r.status==='sent' ? r : false; }, 'notification traitée');
  assert.equal(row.failure_reason,'PUSH_NOT_CONFIGURED_OR_NO_DEVICE');
});

for (const tz of ['America/Los_Angeles','Asia/Tokyo']) test(`E4 : vrai Excel DATE au premier du mois, TZ=${tz}`, async () => {
  const id = await exportRequest('2026-09');
  startWorker({ TZ: tz, PGOPTIONS: `-c timezone=${tz}` });
  const row = await waitFor(async () => { const r=await exportRow(id); return r.status==='done' ? r : false; }, 'classeur');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(join(root,row.storage_key));
  assert.equal(wb.worksheets[0].getRow(2).getCell(5).value,'2026-09-01');
  assert.equal(wb.worksheets[0].getRow(2).getCell(7).value,'08:00', 'horaire Alger indépendant du TZ process et PostgreSQL');
});

test('E6 : période date simple acceptée par l’API produit effectivement le fichier', async () => {
  const id = await exportRequest('2026-09-01');
  startWorker();
  const bg = await waitFor(async () => (await db.query("SELECT * FROM background_jobs WHERE payload->>'export_id'=$1 AND status IN ('done','failed')",[id])).rows[0], 'job date simple');
  assert.equal(bg.status,'done',bg.failure_reason);
  assert.equal((await exportRow(id)).status,'done');
});

test('E6 : échec terminal du stockage visible dans la liste API, pas pending éternel', async () => {
  const id = await exportRequest('2026-09');
  const badRoot=join(root,'not-a-directory'); writeFileSync(badRoot,'test');
  startWorker({ STORAGE_LOCAL_DIR: badRoot });
  await waitFor(async () => (await db.query("SELECT 1 FROM background_jobs WHERE payload->>'export_id'=$1 AND status='failed'",[id])).rowCount, 'échec stockage');
  const list=await request('GET','/exports');
  const row=list.body.find(r=>r.id===id);
  assert.equal(row.status,'failed'); assert.ok(row.failure_reason);
});

test('E5 : contrats partiels/futurs exclus, seul le mois intégral est facturé', async () => {
  await contract('2026-09-15'); await contract('2026-10-01');
  const full=await contract('2026-09-01','2026-09-30'); await contract('2026-09-01','2026-09-15');
  const id=await job('send_monthly_invoices',{ period_year:2026,period_month:9,due_date:'2026-09-30' });
  startWorker(); assert.equal((await settled(id)).status,'done');
  const rows=(await db.query('SELECT contract_id FROM invoices WHERE contract_id IN (SELECT id FROM contracts WHERE is_active)')).rows;
  assert.deepEqual(rows,[{contract_id:full}]);
});

test('E5 : le total des lignes ne double pas repas et transport', async () => {
  const c=await contract('2026-09-01',null,true);
  const id=await job('send_monthly_invoices',{period_year:2026,period_month:9,due_date:'2026-09-30'});
  startWorker(); assert.equal((await settled(id)).status,'done');
  const r=(await db.query(`SELECT i.subtotal, i.total_amount, SUM(l.total_price) AS lines FROM invoices i
    JOIN invoice_lines l ON l.invoice_id=i.id WHERE i.contract_id=$1 GROUP BY i.id`,[c])).rows[0];
  assert.equal(Number(r.lines),Number(r.subtotal)); assert.equal(Number(r.total_amount),11880);
});

test('E5 : erreur enqueue PDF annule aussi la création de facture (transaction atomique)', async () => {
  const c=await contract();
  const id=await job('send_monthly_invoices',{period_year:2026,period_month:9,due_date:'2026-09-30'});
  await db.query(`CREATE FUNCTION phase28_reject_pdf() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.job_type='generate_invoice_pdf' THEN RAISE EXCEPTION 'PDF_QUEUE_TEST_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER phase28_reject_pdf BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION phase28_reject_pdf()`);
  try {
    startWorker(); assert.equal((await settled(id)).status,'failed');
    assert.equal((await db.query('SELECT 1 FROM invoices WHERE contract_id=$1',[c])).rowCount,0);
  } finally { await db.query('DROP TRIGGER phase28_reject_pdf ON background_jobs; DROP FUNCTION phase28_reject_pdf()'); }
});

test('E2 : trois producteurs planifiés exécutent réellement leurs effets, jamais la facturation', async () => {
  const audit=(await db.query("INSERT INTO audit_logs(action,resource_type,occurred_at) VALUES('create','phase28',NOW()-INTERVAL '10 years') RETURNING id")).rows[0].id;
  const camera=(await db.query("INSERT INTO video_cameras(organization_id,name,zone,created_by) VALUES($1,'E28','entrance',$2) RETURNING id",[org,user])).rows[0].id;
  const key=`${org}/video/expired.mp4`; mkdirSync(dirname(join(root,key)),{recursive:true}); writeFileSync(join(root,key),'clip test');
  const clip=(await db.query(`INSERT INTO video_clips(organization_id,camera_id,captured_at,storage_backend,storage_key,uploaded_by,uploaded_at)
    VALUES($1,$2,NOW()-INTERVAL '35 days','local',$3,$4,NOW()-INTERVAL '35 days') RETURNING id`,[org,camera,key,user])).rows[0].id;
  const payment=(await db.query(`INSERT INTO payments(organization_id,reference_number,child_id,amount,method,payment_gateway,created_by,created_at)
    VALUES($1,$2,$3,1000,'cib','satim',$4,NOW()-INTERVAL '80 hours') RETURNING id`,[org,randomUUID(),child,user])).rows[0].id;
  // Injection de ticks passés, pas d’horloge fictive dans le worker. Avant 056,
  // aucune table/producteur : le test échoue sur l'absence de vrais jobs.
  if ((await db.query("SELECT to_regclass('scheduler_ticks') AS t")).rows[0].t) await db.query("UPDATE scheduler_ticks SET next_run_at=NOW()-INTERVAL '1 minute'");
  const state=startWorker({ WORKER_SCHEDULER_ENABLED:'true' });
  await waitFor(async () => (await db.query("SELECT count(DISTINCT job_type)::int AS n FROM background_jobs WHERE status='done' AND job_type=ANY($1)",[['video_clips_purge','retention_purge','payments_expire']])).rows[0].n===3, '3 traitements planifiés exécutés');
  assert.equal((await db.query('SELECT 1 FROM audit_logs WHERE id=$1',[audit])).rowCount,0);
  assert.equal((await db.query('SELECT 1 FROM video_clips WHERE id=$1',[clip])).rowCount,0); assert.equal(existsSync(join(root,key)),false);
  assert.equal((await db.query('SELECT status FROM payments WHERE id=$1',[payment])).rows[0].status,'failed');
  assert.equal((await db.query("SELECT 1 FROM background_jobs WHERE job_type='send_monthly_invoices'")).rowCount,0);
  await delay(300);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM background_jobs')).rows[0].n,3, state.output);
});



test('E2 : une purge vidéo traite aussi le 501e clip, pas seulement le premier batch', async () => {
  const camera=(await db.query("INSERT INTO video_cameras(organization_id,name,zone,created_by) VALUES($1,'bulk-E28','entrance',$2) RETURNING id",[org,user])).rows[0].id;
  await db.query(`INSERT INTO video_clips(organization_id,camera_id,captured_at,storage_backend,storage_key,uploaded_by,uploaded_at)
    SELECT $1::uuid,$2,NOW()-INTERVAL '35 days','local',$1::uuid::text||'/video/bulk-'||n::text||'.mp4',$3,NOW()-INTERVAL '35 days'
    FROM generate_series(1,501) n`,[org,camera,user]);
  const id=await job('video_clips_purge',{},null); startWorker();
  assert.equal((await settled(id)).status,'done');
  assert.equal((await db.query('SELECT 1 FROM video_clips WHERE camera_id=$1',[camera])).rowCount,0);
});

for (const tz of ['America/Los_Angeles','Asia/Tokyo']) test(`E4 : échéance exacte dans le PDF et l’Excel factures, TZ=${tz}`, async () => {
  const number=`PDF-${randomUUID()}`;
  const invoice=(await db.query(`INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,due_date,created_by)
    VALUES($1,$2,$3,2026,9,100,100,'2026-09-01',$4) RETURNING id`,[org,number,child,user])).rows[0].id;
  const id=await job('generate_invoice_pdf',{invoice_id:invoice});
  const exportId=await exportRequest('2026-09','invoices'); startWorker({TZ:tz});
  assert.equal((await settled(id)).status,'done');
  const key=(await db.query('SELECT pdf_url FROM invoices WHERE id=$1',[invoice])).rows[0].pdf_url;
  assert.ok(pdfText(readFileSync(join(root,key))).includes('2026-09-01'), 'texte de l’échéance du vrai PDF');
  const row=await waitFor(async()=>{const r=await exportRow(exportId);return r.status==='done'?r:false;},'Excel factures');
  const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(join(root,row.storage_key));
  const found=wb.worksheets[0].getRows(2,wb.worksheets[0].rowCount).find(r=>r.getCell(1).value===number);
  assert.equal(found.getCell(8).value,'2026-09-01');
});

test('E5 : échéance fin de mois, rejeu sans doublon et facture payée intacte', async () => {
  const c=await contract(); const payload={period_year:2026,period_month:9};
  let id=await job('send_monthly_invoices',payload); const worker=startWorker();
  assert.equal((await settled(id)).status,'done'); await stop(worker);
  const invoice=(await db.query('SELECT id,due_date::text,total_amount FROM invoices WHERE contract_id=$1',[c])).rows[0];
  assert.equal(invoice.due_date,'2026-09-30');
  await db.query("UPDATE invoices SET paid_amount=total_amount,status='paid' WHERE id=$1",[invoice.id]);
  id=await job('send_monthly_invoices',payload); startWorker(); assert.equal((await settled(id)).status,'done');
  const rows=(await db.query('SELECT id,due_date::text,total_amount,status FROM invoices WHERE contract_id=$1',[c])).rows;
  assert.deepEqual(rows,[{...invoice,status:'paid'}]);
  assert.equal((await db.query("SELECT 1 FROM background_jobs WHERE job_type='generate_invoice_pdf' AND payload->>'invoice_id'=$1",[invoice.id])).rowCount,1);
});

test('E6 : période invalide ou inversée refusée avant enqueue', async () => {
  for(const period of ['2026-02-30','2026-13','2026-09-10..2026-09-01','2026-09..2026-10-01']) {
    const r=await request('POST','/exports',{report_type:'attendance',period}); assert.equal(r.status,400,period);
  }
  assert.equal((await db.query('SELECT 1 FROM report_exports')).rowCount,0);
  assert.equal((await request('POST','/exports',{report_type:'invoices',period:'2026-09-01'})).status,400);
});

test('E6 : export bloqué dépassant sa durée → failed visible et arrêt du handler', async () => {
  const id=await exportRequest('2026-09');
  const lock=new pg.Client({connectionString:adminUrl}); await lock.connect(); await lock.query('BEGIN; LOCK TABLE attendance_sessions IN ACCESS EXCLUSIVE MODE');
  const state=startWorker({WORKER_EXPORT_TIMEOUT_MS:'400'});
  try {
    await waitFor(async()=> (await exportRow(id)).status==='failed','timeout export');
    assert.equal((await exportRow(id)).failure_reason,'EXPORT_TIMEOUT');
    const result=await state.exit; assert.equal(result.code,1); assert.match(state.output,/EXPORT_TIMEOUT/);
  } finally {await lock.query('ROLLBACK'); await lock.end();}
  assert.equal((await exportRow(id)).storage_key,null);
});

test('E6 : attente >30 min réconciliée par l’API même sans worker, tenant B intact', async () => {
  const id=await exportRequest('2026-09');
  await db.query("UPDATE report_exports SET last_requested_at=NOW()-INTERVAL '31 minutes' WHERE id=$1",[id]);
  const b=(await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'B','31') RETURNING id",[randomUUID()])).rows[0].id;
  const other=(await db.query(`INSERT INTO report_exports(organization_id,report_type,period_label,requested_by,last_requested_at)
    VALUES($1,'attendance','2026-09',$2,NOW()-INTERVAL '31 minutes') RETURNING id`,[b,user])).rows[0].id;
  const r=await request('GET','/exports'); assert.equal(r.body.find(e=>e.id===id).status,'failed');
  assert.equal((await exportRow(other)).status,'pending');
  const bg=(await db.query("SELECT id,status FROM background_jobs WHERE payload->>'export_id'=$1",[id])).rows[0];
  assert.equal(bg.status,'failed');
  await appDb.query('SELECT support_retry_job($1)',[bg.id]);
  assert.equal((await exportRow(id)).status,'pending');
  assert.equal((await exportRow(id)).failure_reason,null);
  startWorker(); await waitFor(async()=> (await exportRow(id)).status==='done','export repris explicitement');
});

test('E2 : concurrence scheduler sans doublon et facturation impossible à activer implicitement', async () => {
  await db.query("UPDATE scheduler_ticks SET next_run_at=NOW()-INTERVAL '3 days'");
  const connections=[new pg.Client({connectionString:appUrl()}),new pg.Client({connectionString:appUrl()})];
  await Promise.all(connections.map(c=>c.connect()));
  try {
    const results=await Promise.all(connections.map(c=>c.query('SELECT scheduler_enqueue_due() AS n')));
    assert.equal(results.reduce((n,r)=>n+r.rows[0].n,0),3);
    assert.equal((await appDb.query('SELECT scheduler_enqueue_due() AS n')).rows[0].n,0);
    assert.equal((await db.query('SELECT 1 FROM background_jobs')).rowCount,3);
    assert.equal((await appDb.query('SELECT 1 FROM scheduler_ticks')).rowCount,0);
    await assert.rejects(appDb.query("INSERT INTO scheduler_ticks(job_type,enabled,next_run_at) VALUES('payments_expire',true,NOW())"),{code:'42501'});
    await assert.rejects(db.query("UPDATE scheduler_ticks SET enabled=true WHERE job_type='send_monthly_invoices'"),{code:'23514'});
  } finally {await Promise.all(connections.map(c=>c.end()));}
});

test('E2 : horaires Alger et alerte de fraîcheur lisible sans worker', async () => {
  for(const [type,after,expected] of [
    ['video_clips_purge','2026-09-13T23:00:00Z','2026-09-14T01:00:00.000Z'],
    ['retention_purge','2026-09-14T01:00:00Z','2026-09-15T01:00:00.000Z'],
    ['payments_expire','2026-09-14T23:15:00Z','2026-09-15T00:00:00.000Z'],
    ['send_monthly_invoices','2026-08-31T21:00:00Z','2026-09-01T02:00:00.000Z'],
  ]) assert.equal((await appDb.query('SELECT scheduler_next_run($1,$2) AS t',[type,after])).rows[0].t.toISOString(),expected);
  await db.query("UPDATE scheduler_ticks SET last_success_at=NOW()-INTERVAL '3 days'");
  const rows=(await appDb.query('SELECT * FROM scheduler_health()')).rows;
  assert.equal(rows.length,3); assert.ok(rows.every(r=>r.overdue));
  await db.query('UPDATE scheduler_ticks SET last_success_at=NOW()');
  assert.ok((await appDb.query('SELECT * FROM scheduler_health()')).rows.every(r=>!r.overdue));
});

test('E2 : expiration de plus de 500 paiements dans le même traitement', async () => {
  await db.query(`INSERT INTO payments(organization_id,reference_number,child_id,amount,method,payment_gateway,created_by,created_at)
    SELECT $1,'BULK-'||gen_random_uuid()::text,$2,1000,'cib','satim',$3,NOW()-INTERVAL '80 hours' FROM generate_series(1,501)`,[org,child,user]);
  const id=await job('payments_expire',{},null); startWorker(); assert.equal((await settled(id)).status,'done');
  assert.equal((await db.query("SELECT 1 FROM payments WHERE reference_number LIKE 'BULK-%' AND status='pending'")).rowCount,0);
});

test('E6 : chaque tentative écrit une clé différente et ne peut publier après perte de bail', async () => {
  const {createServer}=await import('node:http');
  const uploads=[];
  const server=createServer((req,res)=>{ req.resume(); req.on('end',()=>uploads.push({path:req.url,res})); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const id=await exportRequest('2026-09');
  const state=startWorker({STORAGE_BACKEND:'s3', S3_ENDPOINT:`http://127.0.0.1:${server.address().port}`,
    S3_ACCESS_KEY:'test-only',S3_SECRET_KEY:'test-only',S3_BUCKET:'test',S3_REGION:'us-east-1',WORKER_EXPORT_TIMEOUT_MS:'10000'});
  try {
    await waitFor(()=>uploads[0],'PUT S3 bloqué');
    const first=(await db.query("SELECT * FROM background_jobs WHERE payload->>'export_id'=$1",[id])).rows[0];
    await appDb.query('SELECT exports_fail_job($1,$2)',[first.id,first.lease_token]);
    uploads[0].res.writeHead(200,{etag:'"test"'}).end();
    await state.exit;
    assert.equal((await exportRow(id)).status,'failed'); assert.equal((await exportRow(id)).storage_key,null);
    await appDb.query('SELECT support_retry_job($1)',[first.id]);
    const retry=startWorker({STORAGE_BACKEND:'s3',S3_ENDPOINT:`http://127.0.0.1:${server.address().port}`,
      S3_ACCESS_KEY:'test-only',S3_SECRET_KEY:'test-only',S3_BUCKET:'test',S3_REGION:'us-east-1'});
    await waitFor(()=>uploads[1],'deuxième PUT'); uploads[1].res.writeHead(200,{etag:'"test"'}).end();
    await waitFor(async()=> (await exportRow(id)).status==='done','reprise S3'); await stop(retry);
    assert.notEqual(uploads[0].path,uploads[1].path,'un ancien PUT ne doit pas écraser le fichier de la nouvelle tentative');
    assert.ok((await exportRow(id)).storage_key.startsWith(`${org}/exports/${id}/`));
  } finally {
    await Promise.all([...workers].map(stop)); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});


test('E4/E6 : calendrier strict, année bissextile et DATE jamais convertie en instant', async () => {
  const {dateOnly,monthBounds,exportRange,BUSINESS_TIME_ZONE}=await import('@creche/prod-config');
  assert.equal(BUSINESS_TIME_ZONE,'Africa/Algiers');
  assert.deepEqual(monthBounds(2028,2),['2028-02-01','2028-02-29']);
  assert.deepEqual(monthBounds(2026,2),['2026-02-01','2026-02-28']);
  assert.deepEqual(monthBounds(1,1),['0001-01-01','0001-01-31']);
  assert.deepEqual(exportRange('attendance','2028-02-29'),['2028-02-29','2028-02-29']);
  for(const value of [new Date(),null,'0000-01-01','2026-02-29','2026-09-01T00:00:00Z']) assert.throws(()=>dateOnly(value));
});

test('E2 : les trois handlers supportent deux exécutions successives', async () => {
  startWorker();
  for(let round=0;round<2;round++) for(const type of ['retention_purge','video_clips_purge','payments_expire']) {
    const id=await job(type,{},null); assert.equal((await settled(id)).status,'done',type);
  }
  assert.equal((await db.query("SELECT 1 FROM background_jobs WHERE status='done'")).rowCount,6);
  assert.equal((await db.query("SELECT 1 FROM background_jobs WHERE job_type='send_monthly_invoices'")).rowCount,0);
});

test('E6 : le reaper E1 projette aussi un échec terminal d’export et refuse la clôture tardive', async () => {
  const id=await exportRequest('2026-09');
  const bg=(await appDb.query('SELECT * FROM jobs_claim_leased()')).rows[0];
  await db.query("UPDATE background_jobs SET heartbeat_at=NOW()-INTERVAL '20 minutes' WHERE id=$1",[bg.id]);
  await appDb.query("SELECT jobs_reap_stale(INTERVAL '15 minutes')");
  assert.equal((await exportRow(id)).status,'failed');
  assert.equal((await exportRow(id)).failure_reason,'WORKER_LEASE_EXPIRED');
  assert.equal((await appDb.query('SELECT jobs_finish_leased($1,$2,true,NULL) AS ok',[bg.id,bg.lease_token])).rows[0].ok,false);
});
