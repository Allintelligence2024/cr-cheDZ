#!/usr/bin/env node
// E1 : VRAI worker, VRAI PostgreSQL, rôle applicatif (prod via gate D).
// Aucun handler de test : retention_purge est ralenti par un vrai verrou SQL.
import assert from 'node:assert/strict';
import { test, before, beforeEach, afterEach, after } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'), 'Base jetable *_test requise');
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const children = new Set();
let app;

async function waitFor(check, label, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`Timeout : ${label}`);
}

function worker(extra = {}) {
  const tag = `worker-e1-${randomUUID()}`;
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env: {
      ...process.env, DATABASE_URL: appUrl(), PGAPPNAME: tag,
      // Production réelle pour le gate ; le mode historique utilise le clone.
      NODE_ENV: process.env.PRODUCTION_ROLE_TESTS === '1' ? 'production' : 'test',
      JWT_SECRET: 'phase-e-local-only-jwt-secret-at-least-32',
      PAYMENT_WEBHOOK_SECRET: 'phase-e-local-only-webhook-secret-at-least-32',
      STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/tmp/phase-e-worker-storage',
      SENTRY_DSN: '', FIREBASE_SERVICE_ACCOUNT_JSON: '',
      WORKER_POLL_MS: '50', WORKER_REAPER_INTERVAL_MS: '100',
      WORKER_JOB_TIMEOUT_MS: '1200', WORKER_HEARTBEAT_MS: '150',
      WORKER_SHUTDOWN_TIMEOUT_MS: '5000', ...extra,
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, tag, output: '', exited: false, result: null };
  child.stdout.on('data', b => { state.output += b; });
  child.stderr.on('data', b => { state.output += b; });
  state.exit = new Promise(resolve => child.once('exit', (code, signal) => {
    state.exited = true; state.result = { code, signal }; children.delete(state); resolve(state.result);
  }));
  children.add(state);
  return state;
}
async function terminate(state, signal = 'SIGKILL') {
  if (!state.exited) state.child.kill(signal);
  await state.exit;
}
async function job(status = 'pending', attempts = 0, max = 3) {
  return (await admin.query(`INSERT INTO background_jobs(job_type,payload,status,attempts,max_attempts,started_at)
    VALUES('retention_purge','{}',$1::job_status,$2,$3, CASE WHEN $1::job_status='processing' THEN NOW()-INTERVAL '1 hour' END)
    RETURNING id`, [status, attempts, max])).rows[0].id;
}
async function row(id) { return (await admin.query('SELECT * FROM background_jobs WHERE id=$1', [id])).rows[0]; }
async function holdPurge() {
  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  await locker.query('BEGIN; LOCK TABLE audit_logs IN ACCESS EXCLUSIVE MODE');
  return async () => { await locker.query('ROLLBACK'); await locker.end(); };
}
async function waitBlocked(state, id) {
  await waitFor(async () => (await row(id)).status === 'processing', `job claimed : ${state.output}`);
  await waitFor(async () => (await admin.query(`SELECT 1 FROM pg_stat_activity
    WHERE application_name=$1 AND wait_event_type='Lock'`, [state.tag])).rowCount > 0, 'vrai handler bloqué sur SQL');
}

before(async () => {
  execFileSync(process.execPath, ['scripts/migrate.mjs', '--reset'], { env: { ...process.env, NODE_ENV: 'test' }, stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/seed.mjs'], { env: process.env, stdio: 'pipe' });
  await admin.connect();
  await ensureAppRole(admin);
  app = new pg.Client({ connectionString: appUrl() });
  await app.connect();
});
beforeEach(async () => { await admin.query('TRUNCATE background_jobs'); });
afterEach(async () => { await Promise.all([...children].map(s => terminate(s))); });
after(async () => { if (app) await app.end(); await admin.end(); });

test('E1 : SIGKILL pendant un job long → reprise réelle et succès au second essai', async () => {
  const id = await job();
  const oldAudit = (await admin.query(`INSERT INTO audit_logs(action,resource_type,occurred_at)
    VALUES('create','phase-e1',NOW()-INTERVAL '10 years') RETURNING id`)).rows[0].id;
  const unlock = await holdPurge();
  const first = worker();
  try {
    await waitBlocked(first, id);
    await terminate(first);
    assert.equal(first.result.signal, 'SIGKILL');
    assert.equal((await row(id)).status, 'processing', 'mort du process, pas terminaison artificielle du job');
  } finally { await unlock(); }
  const second = worker();
  await waitFor(async () => (await row(id)).status === 'done', 'job orphelin repris après expiration du bail');
  assert.equal((await row(id)).attempts, 2);
  assert.equal((await admin.query('SELECT id FROM audit_logs WHERE id=$1', [oldAudit])).rowCount, 0, 'handler réellement exécuté');
  await terminate(second, 'SIGTERM');
});

for (const signal of ['SIGTERM', 'SIGINT']) test(`E1 : ${signal} termine le job en cours et ne réclame pas le suivant`, async () => {
  const id = await job();
  const unlock = await holdPurge();
  const state = worker();
  try {
    await waitBlocked(state, id);
    const nextId = await job();
    state.child.kill(signal);
    await delay(200);
    assert.equal(state.exited, false, 'le worker doit attendre son job, pas mourir au signal');
    await unlock();
    await waitFor(() => state.exited, 'arrêt gracieux borné');
    assert.deepEqual(state.result, { code: 0, signal: null }, state.output);
    assert.equal((await row(id)).status, 'done');
    assert.equal((await row(nextId)).status, 'pending');
  } catch (error) {
    await unlock().catch(() => {});
    throw error;
  }
});

test('E1 : reaper borne les tentatives, conserve les jobs récents et est idempotent', async () => {
  const stale = await job('processing', 1, 3);
  const exhausted = await job('processing', 3, 3);
  const fresh = await job('processing', 1, 3);
  await admin.query('UPDATE background_jobs SET started_at=NOW() WHERE id=$1', [fresh]);
  const reaped = (await app.query("SELECT jobs_reap_stale(INTERVAL '15 minutes') AS n")).rows[0].n;
  assert.equal(reaped, 2);
  assert.equal((await row(stale)).status, 'pending');
  assert.equal((await row(stale)).attempts, 1);
  assert.equal((await row(exhausted)).status, 'failed');
  assert.ok((await row(exhausted)).failed_at);
  assert.equal((await row(exhausted)).failure_reason, 'WORKER_LEASE_EXPIRED');
  assert.equal((await row(fresh)).status, 'processing');
  assert.equal((await app.query("SELECT jobs_reap_stale(INTERVAL '15 minutes') AS n")).rows[0].n, 0);
});

test('E1 : une ancienne terminaison ne transforme pas un job pending en done', async () => {
  const id = await job();
  await app.query('SELECT jobs_finish($1,true)', [id]);
  assert.equal((await row(id)).status, 'pending');
});


test('E1 : heartbeat protège un job long pendant que le reaper d’un autre worker tourne', async () => {
  const id = await job();
  const unlock = await holdPurge();
  const first = worker();
  let second;
  try {
    await waitBlocked(first, id);
    const initial = (await row(id)).heartbeat_at;
    second = worker();
    await delay(2800); // > 2 fois le timeout du test (1200 ms)
    const current = await row(id);
    assert.equal(current.status, 'processing');
    assert.equal(current.attempts, 1, 'ne pas relancer un worker encore vivant');
    assert.ok(current.heartbeat_at > initial, 'renouvellement effectif pendant le blocage SQL du handler');
  } finally { await unlock(); }
  await waitFor(async () => (await row(id)).status === 'done', 'fin du job long');
  assert.equal((await row(id)).attempts, 1);
  await Promise.all([terminate(first, 'SIGTERM'), terminate(second, 'SIGTERM')]);
});

test('E1 : arrêt gracieux borné → expiration du bail et reprise après dépassement', async () => {
  const id = await job();
  const unlock = await holdPurge();
  const first = worker({ WORKER_SHUTDOWN_TIMEOUT_MS: '600' });
  try {
    await waitBlocked(first, id);
    first.child.kill('SIGTERM');
    await waitFor(() => first.exited, 'sortie après deadline');
    assert.deepEqual(first.result, { code: 1, signal: null });
    assert.match(first.output, /WORKER_SHUTDOWN_TIMEOUT/);
    assert.equal((await row(id)).status, 'processing');
  } finally { await unlock(); }
  const second = worker();
  await waitFor(async () => (await row(id)).status === 'done', 'reprise après arrêt forcé');
  assert.equal((await row(id)).attempts, 2);
  await terminate(second, 'SIGTERM');
});

test('E1 : fencing — ancien heartbeat/finish ne peuvent toucher la nouvelle tentative', async () => {
  const id = await job();
  const first = (await app.query('SELECT * FROM jobs_claim_leased()')).rows[0];
  assert.equal(first.attempts, 1, 'numéro réel de tentative, après incrément');
  await admin.query("UPDATE background_jobs SET heartbeat_at=NOW()-INTERVAL '1 hour' WHERE id=$1", [id]);
  await app.query("SELECT jobs_reap_stale(INTERVAL '1 second')");
  const second = (await app.query('SELECT * FROM jobs_claim_leased()')).rows[0];
  assert.equal(second.attempts, 2);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal((await app.query('SELECT jobs_heartbeat($1,$2) AS owned', [id, first.lease_token])).rows[0].owned, false);
  for (const success of [true, false]) {
    assert.equal((await app.query('SELECT jobs_finish_leased($1,$2,$3,$4) AS owned', [id, first.lease_token, success, 'obsolete'])).rows[0].owned, false);
  }
  await app.query('SELECT jobs_finish($1,true)', [id]); // ancienne API : pas de contournement
  assert.equal((await row(id)).status, 'processing');
  assert.equal((await app.query('SELECT jobs_finish_leased($1,$2,true) AS owned', [id, second.lease_token])).rows[0].owned, true);
  assert.equal((await row(id)).status, 'done');
  assert.equal((await app.query('SELECT jobs_finish_leased($1,$2,false) AS owned', [id, second.lease_token])).rows[0].owned, false);
  assert.equal((await row(id)).status, 'done', 'terminaison idempotente');
});

test('E1 : réinitialisation du compteur par le support ne réutilise jamais le bail', async () => {
  const id = await job();
  const first = (await app.query('SELECT * FROM jobs_claim_leased()')).rows[0];
  await app.query('SELECT jobs_finish_leased($1,$2,false,$3)', [id, first.lease_token, 'retry']);
  await app.query('SELECT support_retry_job($1)', [id]);
  const second = (await app.query('SELECT * FROM jobs_claim_leased()')).rows[0];
  assert.equal(first.attempts, second.attempts);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal((await app.query('SELECT jobs_finish_leased($1,$2,true) AS owned', [id, first.lease_token])).rows[0].owned, false);
  assert.equal((await row(id)).status, 'processing');
});

test('E1 : reapers concurrents, lignes verrouillées ignorées puis reprises sans double traitement', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await job('processing', 1));
  const lock = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const others = [new pg.Client({ connectionString: appUrl(), statement_timeout: 1500 }), new pg.Client({ connectionString: appUrl(), statement_timeout: 1500 })];
  await lock.connect(); await Promise.all(others.map(c => c.connect()));
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM background_jobs WHERE id=$1 FOR UPDATE', [ids[0]]);
    const counts = await Promise.all(others.map(c => c.query("SELECT jobs_reap_stale(INTERVAL '1 second') AS n")));
    assert.equal(counts.reduce((n, r) => n + r.rows[0].n, 0), 2);
    assert.equal((await row(ids[0])).status, 'processing');
    await lock.query('ROLLBACK');
    assert.equal((await app.query("SELECT jobs_reap_stale(INTERVAL '1 second') AS n")).rows[0].n, 1);
    assert.equal((await app.query("SELECT jobs_reap_stale(INTERVAL '1 second') AS n")).rows[0].n, 0);
  } finally {
    await lock.query('ROLLBACK'); await lock.end(); await Promise.all(others.map(c => c.end()));
  }
});

test('E1 : timeout nul/négatif refusé et fonctions non exécutables par PUBLIC', async () => {
  for (const interval of [null, '0 seconds', '-1 second']) {
    await assert.rejects(app.query('SELECT jobs_reap_stale($1::interval)', [interval]), { code: '22023' });
  }
  const publicExec = await admin.query(`SELECT p.proname FROM pg_proc p,
    LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.proname=ANY($1) AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
    [['jobs_claim_leased','jobs_heartbeat','jobs_finish_leased','jobs_reap_stale']]);
  assert.equal(publicExec.rowCount, 0);
});

test('E1 : échec handler → failed à la limite, jamais faux succès', async () => {
  const id = await job('pending', 0, 1);
  await admin.query("UPDATE background_jobs SET job_type='compress_media' WHERE id=$1", [id]);
  const state = worker();
  await waitFor(async () => (await row(id)).status === 'failed', 'échec explicite du handler');
  assert.equal((await row(id)).attempts, 1);
  assert.match((await row(id)).failure_reason, /NOT_IMPLEMENTED/);
  assert.equal((await row(id)).lease_token, null);
  await terminate(state, 'SIGTERM');
});


test('E1 : worker perdant son bail sort en erreur au lieu de poursuivre le handler', async () => {
  const id = await job();
  const unlock = await holdPurge();
  const state = worker();
  try {
    await waitBlocked(state, id);
    await admin.query('UPDATE background_jobs SET lease_token=gen_random_uuid() WHERE id=$1', [id]);
    await waitFor(() => state.exited, 'arrêt fail-closed après perte de propriété');
    assert.deepEqual(state.result, { code: 1, signal: null }, state.output);
    assert.match(state.output, /JOB_LEASE_LOST/);
    assert.equal((await row(id)).status, 'processing', 'aucune terminaison avec le jeton obsolète');
  } finally { await unlock(); }
});

test('E1 : configuration des temporisations validée avant traitement', async () => {
  const { workerConfig } = await import('../../apps/worker/dist/job-runtime.js');
  assert.deepEqual(workerConfig({}), { pollMs: 2000, reaperMs: 300000, timeoutMs: 900000, heartbeatMs: 30000, shutdownMs: 45000, schedulePollMs: 60000, exportTimeoutMs: 120000, exportMaxAgeMs: 1800000, schedulerEnabled: true });
  for (const value of ['0', '-1', 'NaN', '1.5', '2147483648', '']) {
    assert.throws(() => workerConfig({ WORKER_JOB_TIMEOUT_MS: value }), /WORKER_CONFIG_INVALID/);
  }
  assert.throws(() => workerConfig({ WORKER_JOB_TIMEOUT_MS: '90000', WORKER_HEARTBEAT_MS: '30000' }), /WORKER_CONFIG_INVALID/);
});
