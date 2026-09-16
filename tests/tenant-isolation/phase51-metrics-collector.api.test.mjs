#!/usr/bin/env node
// H2k: scoped Prometheus collector credential for /api/v1/metrics.
// Real HTTP + PostgreSQL, live env plumbing, official parser, and structural
// checks of the delivered scraping configuration. NO public fallback.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';
import { prometheusParser } from './prometheus-parser.mjs';

const COLLECTOR_ENV = 'METRICS_COLLECTOR_TOKEN_HASHES';
const digest = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
const genToken = () => randomBytes(32).toString('base64url');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
await db.connect();
let app, pool, passed = 0, failed = 0;
const priorHashes = process.env[COLLECTOR_ENV];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
function setCollectorEnv(value) {
  if (value === undefined) delete process.env[COLLECTOR_ENV];
  else process.env[COLLECTOR_ENV] = value;
}
try {
  await ensureAppRole(db);
  setCollectorEnv(undefined); // baseline: no collector provisioned yet
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', SENTRY_DSN: '' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const request = async (path, authorization, method = 'GET') => {
    const r = await fetch(base + path, { method, headers: { ...(authorization ? { authorization } : {}) }, signal: AbortSignal.timeout(10000) });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };
  const bearer = (token) => `Bearer ${token}`;
  const password = 'Synthetic-H2k-only!';
  const hash = await bcrypt.hash(password, 4);
  async function adminLogin() {
    const email = `${randomUUID()}@test.invalid`;
    await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'H2k','Synthetic',$2,'active',true)", [email, hash]);
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(r.status, 200);
    return (await r.json()).access_token;
  }
  const parse = await prometheusParser();
  const adminToken = await adminLogin();

  // ── 1. Reproduction of the operational gap (red before fix): a Prometheus
  // scrape presenting a scoped collector credential has no way to authenticate.
  const collectorToken = genToken();
  setCollectorEnv(digest(collectorToken));
  await check('provisioned collector token scrapes /api/v1/metrics', async () => {
    const r = await request('/metrics', bearer(collectorToken));
    assert.equal(r.status, 200, `collector scrape must authenticate (got ${r.status}: ${r.text.slice(0, 120)})`);
    assert.match(r.headers.get('content-type') ?? '', /text\/plain;.*version=0\.0\.4/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const samples = parse(r.text);
    assert.ok(samples.some(s => s.name === 'creche_jobs_pending'));
  });
  await check('collector response carries the same gauges as the platform-admin response', async () => {
    const viaCollector = parse((await request('/metrics', bearer(collectorToken))).text)
      .filter(s => s.name.startsWith('creche_')).map(s => `${s.name} ${s.value}`).sort();
    const viaAdmin = parse((await request('/metrics', bearer(adminToken))).text)
      .filter(s => s.name.startsWith('creche_')).map(s => `${s.name} ${s.value}`).sort();
    assert.deepEqual(viaCollector, viaAdmin);
  });
  await check('HEAD with a collector token is accepted like GET', async () => {
    const r = await request('/metrics', bearer(collectorToken), 'HEAD');
    assert.equal(r.status, 200);
  });

  // ── 2. Refusals.
  await check('unknown token is refused with 401 and no metric body', async () => {
    const r = await request('/metrics', bearer(genToken()));
    assert.equal(r.status, 401);
    assert.equal(r.text.includes('creche_'), false);
  });
  await check('collector digest set unconfigured: no token is accepted (public fallback stays closed)', async () => {
    setCollectorEnv(undefined);
    const r = await request('/metrics', bearer(collectorToken));
    assert.equal(r.status, 401);
    assert.equal((await request('/metrics', null)).status, 401, 'anonymous must stay 401 without any collector config');
    setCollectorEnv(digest(collectorToken));
  });
  await check('malformed digest entry disables the collector path entirely (fail closed)', async () => {
    setCollectorEnv(`oops,${digest(collectorToken)}`);
    assert.equal((await request('/metrics', bearer(collectorToken))).status, 401);
    assert.equal((await request('/metrics', bearer(adminToken))).status, 200, 'admin path unaffected by a broken collector config');
  });
  await check('a raw token pasted into the digest list is not a digest and is refused', async () => {
    setCollectorEnv(collectorToken.length === 64 ? randomBytes(32).toString('hex') : collectorToken);
    assert.match((await request('/metrics', bearer(collectorToken))).status.toString(), /^401$/);
    setCollectorEnv(digest(collectorToken));
  });
  await check('scheme and separators are strict: not "Bearer", or trailing digest, refused', async () => {
    assert.equal((await request('/metrics', `bearer ${collectorToken}`)).status, 401);
    assert.equal((await request('/metrics', `Token ${collectorToken}`)).status, 401);
    assert.equal((await request('/metrics', bearer(`${collectorToken}x`))).status, 401);
    assert.equal((await request('/metrics', bearer(`${collectorToken} `))).status, 200, 'HTTP server trims optional trailing whitespace; the trimmed token still matches');
  });

  // ── 3. Scope: the credential opens exactly the metrics scrape, nothing else.
  await check('collector token cannot read any business route', async () => {
    for (const path of ['/children', '/staff', '/organizations', '/sync/pull', '/privacy/requests']) {
      const r = await request(path, bearer(collectorToken));
      assert.equal(r.status, 401, `${path} must ignore the collector credential`);
    }
  });
  await check('collector token cannot refresh sessions or reissue credentials', async () => {
    const r = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: bearer(collectorToken) }, body: JSON.stringify({ refresh_token: collectorToken }) });
    assert.ok(r.status === 401 || r.status === 400);
    assert.equal((await r.text()).includes('creche_'), false);
  });
  await check('tenant-role JWT keeps its historical 403 even with a collector configured', async () => {
    const email = `${randomUUID()}@test.invalid`;
    const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2k','31') RETURNING id", [randomUUID()])).rows[0].id;
    const userId = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2k','Tenant',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [org, userId, 'director']);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const token = (await login.json()).access_token;
    const r = await request('/metrics', bearer(token));
    assert.equal(r.status, 403);
    assert.equal(r.text.includes('http_requests_total'), false);
  });

  // ── 4. Rotation and revocation semantics (grace overlap then removal).
  const newToken = genToken();
  await check('rotation overlap: current and previous digests both scrape', async () => {
    setCollectorEnv(`${digest(newToken)},${digest(collectorToken)}`);
    assert.equal((await request('/metrics', bearer(newToken))).status, 200);
    assert.equal((await request('/metrics', bearer(collectorToken))).status, 200);
  });
  await check('revocation: dropping the old digest cuts the previous collector off, 401 without metrics', async () => {
    setCollectorEnv(`${digest(newToken)}, ${digest(collectorToken).toUpperCase()}`); // dedup + case-insensitive hex
    assert.equal((await request('/metrics', bearer(newToken))).status, 200);
    setCollectorEnv(digest(newToken));
    const r = await request('/metrics', bearer(collectorToken));
    assert.equal(r.status, 401);
    assert.equal(r.text.includes('creche_'), false);
  });

  // ── 5. No credential material in any output; exposition stays valid under failures.
  await check('neither the response nor counters ever echo the credential', async () => {
    const text = (await request('/metrics', bearer(newToken))).text;
    assert.equal(text.includes(newToken.slice(0, 8)), false);
    assert.equal(text.includes(digest(newToken)), false);
    assert.equal(/authorization/i.test(text), false);
  });
  await check('collector path keeps NaN (never false zeros) when the gauge function is unavailable', async () => {
    await db.query('ALTER FUNCTION metrics_global_counts() RENAME TO h2k_metrics_unavailable');
    try {
      const r = await request('/metrics', bearer(newToken));
      assert.equal(r.status, 200);
      assert.match(r.text, /creche_jobs_pending NaN/);
    } finally {
      await db.query('ALTER FUNCTION h2k_metrics_unavailable() RENAME TO metrics_global_counts');
    }
  });

  // ── 6. Shared production config gate (boot fail-fast on malformed digest list).
  await check('prod-config refuses startup on a malformed collector digest list in production', async () => {
    const { validateProductionConfig } = await import('@creche/prod-config');
    const baseEnv = {
      NODE_ENV: 'production', PAYMENT_WEBHOOK_SECRET: 'x'.repeat(32), JWT_SECRET: 'y'.repeat(48),
      STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/srv/creche-storage',
    };
    assert.deepEqual(validateProductionConfig({ ...baseEnv }), []);
    const problems = validateProductionConfig({ ...baseEnv, [COLLECTOR_ENV]: 'zzz,deadbeef' });
    assert.ok(problems.some(p => p.includes(COLLECTOR_ENV)), `explicit startup refusal required, got: ${problems.join(' | ')}`);
    assert.ok(problems.every(p => !p.includes('deadbeef')), 'malformed values are masked, never echoed');
    assert.deepEqual(validateProductionConfig({ ...baseEnv, [COLLECTOR_ENV]: `${digest(newToken)},, ${digest(genToken())}` }), []);
  });
  await check('provisioning guard: a weak secret shorter than 32 bytes is refused at provisioning', async () => {
    const { MIN_SECRET_LENGTH } = await import('@creche/prod-config');
    assert.ok(MIN_SECRET_LENGTH >= 32, 'production secrets share the 32-byte floor');
    const weak = randomBytes(8).toString('base64url');
    const r = spawnSync(process.execPath, ['scripts/provision-metrics-collector.mjs', '--hash-file', await (async () => {
      const dir = mkdtempSync(join(tmpdir(), 'h2k-weak-'));
      const f = join(dir, 'token');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(f, `${weak}\n`, { mode: 0o600 });
      return f;
    })()], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'a collector secret below 32 bytes must not provision silently');
    assert.match(`${r.stderr}${r.stdout}`, /too short|trop court|32/i);
  });

  // ── 7. Provisioning tool: generates matched material, writes secrets safely.
  await check('provision script: generated token hashes to the printed digest; file stays out of the repo', async () => {
    assert.ok(existsSync('scripts/provision-metrics-collector.mjs'), 'provisioning tool must ship with the credential design');
    const outDir = mkdtempSync(join(tmpdir(), 'h2k-provision-'));
    const outFile = join(outDir, 'metrics-collector-token');
    const run = spawnSync(process.execPath, ['scripts/provision-metrics-collector.mjs', '--out-file', outFile], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const stdout = run.stdout;
    const hashLine = stdout.match(/METRICS_COLLECTOR_TOKEN_HASHES=([0-9a-f]{64})/);
    assert.ok(hashLine, `digest line required, got: ${stdout}`);
    assert.equal(existsSync(outFile), true);
    const fileMode = statSync(outFile).mode & 0o777;
    assert.ok(fileMode === 0o600 || fileMode === 0o400, `token file must be owner-private, got mode ${fileMode.toString(8)}`);
    const token = readFileSync(outFile, 'utf8').trim();
    assert.equal(digest(token), hashLine[1], 'digest must match the file content exactly (Prometheus sends the trimmed file value)');
    assert.equal(stdout.includes(token), false, 'with --out-file the secret itself must not be echoed');
    assert.ok(token.length >= 43, '32 bytes of entropy in base64url');
    const insideRepo = spawnSync(process.execPath, ['scripts/provision-metrics-collector.mjs', '--out-file', join(process.cwd(), 'oops-token')], { encoding: 'utf8' });
    assert.notEqual(insideRepo.status, 0, 'refuse writing a secret inside the repository');
    assert.equal(existsSync(join(process.cwd(), 'oops-token')), false);
  });

  // ── 8. Delivered scraping configuration (structure; E2 stays independent).
  await check('prometheus.yml scrapes the API with the external credentials file, never with inline admin secrets', async () => {
    const text = readFileSync('infrastructure/monitoring/prometheus.yml', 'utf8');
    const apiJob = text.split('- job_name:')[1];
    assert.ok(apiJob, 'api job expected');
    assert.match(apiJob, /metrics_path:\s*\/api\/v1\/metrics/);
    assert.match(apiJob, /credentials_file:\s*\/run\/secrets\/metrics-collector-token/);
    assert.equal(/bearer_token:/.test(apiJob), false, 'no inline secret in the config');
    assert.equal(/(username|password):/.test(apiJob), false, 'no admin credentials in the scrape config');
    assert.equal(/basic_auth:/.test(apiJob), false);
    assert.match(text, /job_name:\s*'postgres'/, 'E2 SQL exporter job preserved untouched');
    assert.match(text, /postgres-exporter:9187/);
    assert.match(text, /rule_files:/);
  });
  await check('prod compose mounts the collector secret read-only and passes only digests to the API', async () => {
    const text = readFileSync('infrastructure/docker/docker-compose.prod.yml', 'utf8');
    assert.match(text, /METRICS_COLLECTOR_TOKEN_HASHES: \$\{METRICS_COLLECTOR_TOKEN_HASHES:-\}/);
    assert.match(text, /\$\{METRICS_COLLECTOR_TOKEN_FILE:\?[^}]*\}:\/run\/secrets\/metrics-collector-token:ro/);
    assert.equal(/METRICS_COLLECTOR_TOKEN_FILE[^:]*:[^r]*rw/.test(text), false);
    const promBlock = text.slice(text.indexOf('  prometheus:'), text.indexOf('  alertmanager:'));
    assert.match(promBlock, /metrics-collector-token:ro/);
    assert.equal(/METRICS_COLLECTOR_TOKEN[^_]/.test(text.replace(/METRICS_COLLECTOR_TOKEN_HASHES/g, '').replace(/METRICS_COLLECTOR_TOKEN_FILE/g, '')), false, 'no raw-token env var — only the digest list and the file path');
  });
  await check('staging compose passes the optional digest env without any secret default', async () => {
    const text = readFileSync('infrastructure/docker/docker-compose.staging.yml', 'utf8');
    assert.match(text, /METRICS_COLLECTOR_TOKEN_HASHES: \$\{METRICS_COLLECTOR_TOKEN_HASHES:-\}/);
    assert.equal(/metrics-collector-token/.test(text), false, 'no Prometheus service in staging: no phantom mount');
  });
  await check('.env examples document the collector variables without embedding a secret', async () => {
    for (const file of ['.env.example', '.env.prod.example']) {
      const text = readFileSync(file, 'utf8');
      assert.match(text, /METRICS_COLLECTOR_TOKEN_HASHES=/, `${file}: digest list documented`);
      assert.match(text, /METRICS_COLLECTOR_TOKEN_FILE=/, `${file}: token file path documented`);
      assert.equal(/[0-9a-f]{64}\s*$/m.test(text.split('METRICS_COLLECTOR_TOKEN_HASHES')[1].split('\n')[0]), false, `${file}: no literal digest committed`);
    }
  });

  // ── 9. Admin path regressions (the H2j contract itself must not move).
  await check('platform-admin access and its re-check under locks stay intact with a collector configured', async () => {
    assert.equal((await request('/metrics', bearer(adminToken))).status, 200);
    const email = `${randomUUID()}@test.invalid`;
    const userId = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'H2k','Fallen',$2,'active',true) RETURNING id", [email, hash])).rows[0].id;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const staleToken = (await login.json()).access_token;
    await db.query('UPDATE users SET is_super_admin=false WHERE id=$1', [userId]);
    assert.equal((await request('/metrics', bearer(staleToken))).status, 403);
  });
  await check('anonymous scraping stays 401 forever: the collector is additive, not a public fallback', async () => {
    const r = await request('/metrics', null);
    assert.equal(r.status, 401);
    assert.equal(r.text.includes('http_requests_total'), false);
  });
} finally {
  if (priorHashes === undefined) delete process.env[COLLECTOR_ENV];
  else process.env[COLLECTOR_ENV] = priorHashes;
  if (app) await app.close();
  if (pool) await pool.end();
  await db.end();
}
console.log(`H2k metrics collector: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
