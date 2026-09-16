#!/usr/bin/env node
/**
 * H2k — GATE d'ingestion réelle du scrape API par un VRAI serveur Prometheus.
 *
 * Un parseur de texte n'est pas une ingestion : ce gate démarre le serveur
 * Prometheus épinglé en production (prom/prometheus:v2.53.0 via Docker en CI,
 * ou PROMETHEUS_BIN local avec version ≥ 2.53 vérifiée), sur la CONFIG LIVRÉE
 * infrastructure/monitoring/prometheus.yml (seuls ports/intervalles/chemins du
 * fichier de config sont adaptés au sandbox), puis :
 *   1. exige que le target `api` passe UP avec credentials_file (collecte OK) ;
 *   2. compare une série requêtée via l'API HTTP de Prometheus au comptage SQL ;
 *   3. bascule le fichier monté sur un token inconnu → target DOWN, lastError 401 ;
 *   4. rotation (nouveau token + liste transitoire des deux digests,
 *      redéploiement de l'API seul) → UP à nouveau, ancien token encore admis
 *      pendant la grâce ;
 *   5. révocation (ancien digest retiré, sans toucher au code) → target DOWN
 *      401 côté ingestion ET 401 direct ; la voie admin JWT (H2j) reste saine ;
 *   6. vérifie qu'aucun secret n'apparaît dans la config montée ni dans les logs.
 * La voie E2 (exporter SQL, sans API ni auth) garde son propre gate, inchangé.
 *
 * Prérequis : cluster jetable *_test, rôles de production bootstrapés (comme
 * le gate E2), apps buildées. Docker OU PROMETHEUS_BIN=<binaire prometheus>.
 */
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// G5 diagnostic : les logs bruts des jobs privés ne sont pas lisibles par
// l'agent (portée Actions) — la première erreur non traitée est publiée en
// annotation GitHub (message tronqué, jamais de secret) pour rendre le
// prochain échec diagnostiquable via l'API check-runs/annotations.
process.on('unhandledRejection', (error) => {
  // G5 diagnostic : sortie SYNCHRONE (console.log + exit perdaient le
  // message, pipe non vidé), jamais de secret, message tronqué.
  const detail = String(error?.message ?? error).replace(/\r?\n/g, ' | ').slice(0, 900);
  if (process.env.GITHUB_ACTIONS === 'true') writeSync(2, `::error title=H2k stack interrompue::${detail}\n`);
  console.error(error);
  process.exitCode = 1;
});

assert.equal(process.env.ALLOW_DATABASE_RESET, '1', 'Cluster jetable requis');
assert.equal(process.env.PRODUCTION_ROLE_TESTS, '1', 'Gate exige les vrais rôles de production');
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
assert.ok(process.env.APP_DATABASE_URL);

const PROM_IMAGE = 'prom/prometheus:v2.53.0'; // exactement l'image épinglée en prod
const useDocker = !process.env.PROMETHEUS_BIN && spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
if (!useDocker && !process.env.PROMETHEUS_BIN) {
  console.error("Ni Docker ni PROMETHEUS_BIN disponible : gate H2k d'ingestion réelle NON EXÉCUTÉ (obligatoire sur GitHub, jamais un skip silencieux).");
  process.exit(2);
}
if (process.env.PROMETHEUS_BIN) {
  const v = spawnSync(process.env.PROMETHEUS_BIN, ['--version'], { encoding: 'utf8' });
  assert.equal(v.status, 0, `PROMETHEUS_BIN injoignable : ${process.env.PROMETHEUS_BIN}`);
  const match = /prometheus, version (\d+)\.(\d+)/.exec((v.stdout ?? '') + (v.stderr ?? ''));
  assert.ok(match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 53)),
    'PROMETHEUS_BIN doit être Prometheus ≥ 2.53 (version épinglée en production) pour qualifier le même comportement');
}

const dir = mkdtempSync(join(tmpdir(), `creche-h2k-stack-${process.pid}-`));
chmodSync(dir, 0o755);
const dockerName = `creche-h2k-${process.pid}`;
let apiChild = null;
let promProcess = null;
let apiPort = 0;
const promPort = await port();

async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
async function until(check, label, ms = 90000) {
  const deadline = Date.now() + ms;
  let lastCheckError = null;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (e) { lastCheckError = e; }
    await delay(400);
  }
  // G5 diagnostic : un timeout nu ne dit rien — porter la dernière erreur de
  // sonde + les queues de logs api/prometheus (aucun token : les logs serveur
  // sont déjà filtrés côté API ; les nôtres ne contiennent que du texte de boot).
  const context = [
    lastCheckError ? `sonde=${String(lastCheckError.message).slice(0, 160)}` : '',
    `logs-locaux=${promLogs.slice(-4).join(' ~ ').slice(0, 320)}`,
    useDocker ? `logs-prom=${readPromLogs().split('\n').filter(Boolean).slice(-4).join(' ~ ').slice(0, 320)}` : '',
  ].filter(Boolean).join(' | ');
  throw new Error(`Timeout: ${label} :: ${context}`);
}
function launchPrometheus() {
  if (useDocker) {
    const r = spawnSync('docker', ['run', '-d', '--name', dockerName, '--network', 'host',
      '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${dir}:/etc/h2k:ro`, PROM_IMAGE,
      '--config.file=/etc/h2k/prometheus.yml', '--storage.tsdb.path=/tmp/prom', `--web.listen-address=127.0.0.1:${promPort}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(r.status, 0, `docker run prometheus: ${r.stderr}`);
  } else {
    promProcess = spawn(process.env.PROMETHEUS_BIN,
      [`--config.file=${join(dir, 'prometheus.yml')}`, `--storage.tsdb.path=${join(dir, 'tsdb')}`, `--web.listen-address=127.0.0.1:${promPort}`],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    promProcess.stdout.on('data', (d) => promLogs.push(String(d)));
    promProcess.stderr.on('data', (d) => promLogs.push(String(d)));
  }
}
const promLogs = [];
function readPromLogs() {
  if (!useDocker) return promLogs.join('');
  const r = spawnSync('docker', ['logs', dockerName], { encoding: 'utf8' });
  return (r.stdout ?? '') + (r.stderr ?? '');
}
async function apiTargets() {
  const j = await (await fetch(`http://127.0.0.1:${promPort}/api/v1/targets`)).json();
  return j.data.activeTargets.filter((t) => t.labels.job === 'api');
}
async function provisionToken(label) {
  const tokenFile = join(dir, `collector-token-${label}`);
  const run = spawnSync(process.execPath, ['scripts/provision-metrics-collector.mjs', '--out-file', tokenFile], { encoding: 'utf8' });
  assert.equal(run.status, 0, `provisioning script failed: ${run.stderr}`);
  const digest = /METRICS_COLLECTOR_TOKEN_HASHES=([0-9a-f]{64})/.exec(run.stdout)?.[1];
  assert.ok(digest, 'le script doit imprimer le digest correspondant');
  return { token: readFileSync(tokenFile, 'utf8').trim(), digest, tokenFile };
}
async function startApi(hashEnv) {
  apiChild = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_PORT: String(apiPort),
      DATABASE_URL: process.env.APP_DATABASE_URL,
      RATE_LIMIT_DISABLED: 'true',
      STORAGE_BACKEND: 'local',
      STORAGE_LOCAL_DIR: join(dir, 'storage'),
      SENTRY_DSN: '',
      METRICS_COLLECTOR_TOKEN_HASHES: hashEnv ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiChild.stdout.on('data', (d) => promLogs.push(`[api] ${d}`));
  apiChild.stderr.on('data', (d) => promLogs.push(`[api] ${d}`));
  await until(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).ok, 'API prête');
}
async function stopApi() {
  if (!apiChild || apiChild.exitCode !== null) return;
  apiChild.kill('SIGTERM');
  await until(async () => apiChild.exitCode !== null, 'API arrêtée', 15000);
  await delay(600); // relâchement du port avant le redéploiement
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const app = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await app.connect();
const role = (await app.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
assert.equal(role.name, 'creche_app');
assert.equal(role.rolsuper, false);
assert.equal(role.rolbypassrls, false);

// Fixtures : jobs pending connus + administrateur plateforme (voie H2j préservée).
const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES('h2k-stack','H2k','31') RETURNING id")).rows[0].id;
await db.query("INSERT INTO background_jobs(organization_id,job_type,payload) SELECT $1,'retention_purge','{}' FROM generate_series(1,3)", [org]);
const expectedPending = Number((await db.query("SELECT count(*) n FROM background_jobs WHERE status='pending'")).rows[0].n);
const password = 'Synthetic-H2k-stack!';
await db.query('INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,$2,$3,$4,$5,$6)',
  ['h2k-stack@test.invalid', 'H2k', 'Stack', await bcrypt.hash(password, 4), 'active', true]);
copyFileSync('infrastructure/monitoring/alerts.yml', join(dir, 'alerts.yml'));

const promConfig = () => readFileSync('infrastructure/monitoring/prometheus.yml', 'utf8')
  .replaceAll('15s', '1s') // accélère seulement le rythme ; gardes et blocages restent identiques
  .replace('/etc/prometheus/alerts.yml', '/etc/h2k/alerts.yml')
  .replace('/run/secrets/metrics-collector-token', '/etc/h2k/collector-token')
  .replace("'api:3000'", `'127.0.0.1:${apiPort}'`)
  .replace('postgres-exporter:9187', '127.0.0.1:1') // voie E2 hors périmètre : target volontairement mort
  .replace('alertmanager:9093', '127.0.0.1:1');

try {
  const first = await provisionToken('first');
  apiPort = await port();
  await startApi(first.digest);
  copyFileSync(first.tokenFile, join(dir, 'collector-token'));
  chmodSync(join(dir, 'collector-token'), 0o600);
  writeFileSync(join(dir, 'prometheus.yml'), promConfig(), { mode: 0o600 });
  launchPrometheus();
  await until(async () => (await fetch(`http://127.0.0.1:${promPort}/-/ready`)).ok, 'Prometheus prêt');
  await until(async () => (await apiTargets())[0]?.health === 'up', 'target api UP avec le credential de collecte');
  let [target] = await apiTargets();
  assert.equal(target.lastError, '', `scrape propre exigé, got ${target.lastError}`);
  // Le nombre de séries ne vient PAS d'un champ de /api/v1/targets (ce champ
  // n'existe pas dans l'API Prometheus 2.53 — l'erreur de ce gate lui-même a
  // été révélée par son premier vrai run CI). Il se prouve par requête réelle
  // sur l'index : ≥ 8 noms de séries distincts pour le job api.
  const countQ = encodeURIComponent('count(count by (__name__) ({job="api"}))');
  let seriesNames = Number.NaN;
  await until(async () => {
    const q = await (await fetch(`http://127.0.0.1:${promPort}/api/v1/query?query=${countQ}`)).json();
    seriesNames = Number(q.data.result[0]?.value?.[1]);
    return Number.isFinite(seriesNames) && seriesNames >= 8;
  }, `≥ 8 noms de séries distincts collectés pour le job api (got ${seriesNames})`, 30000);

  await until(async () => {
    const q = await (await fetch(`http://127.0.0.1:${promPort}/api/v1/query?query=creche_jobs_pending`)).json();
    const value = Number(q.data.result[0]?.value?.[1]);
    return Number.isFinite(value) && value === expectedPending;
  }, `creche_jobs_pending = ${expectedPending} via /api/v1/query (ingestion réelle, pas un parseur)`);
  // Le self-comptage du scrape n'est visible qu'AU SCRAPE SUIVANT (le hook
  // finish s'exécute après sérialisation de l'exposition) : sans re-tentative,
  // cette lecture gagnait ou perdait une course de ~1 s selon la machine.
  await until(async () => {
    const series = await (await fetch(`http://127.0.0.1:${promPort}/api/v1/series?match%5B%5D=http_requests_total`)).json();
    assert.equal(series.status, 'success');
    return series.data.some((s) => s.route === '/api/v1/metrics');
  }, 'le scrape lui-même est compté (route template, jamais un chemin privé)', 30000);

  // Refus réel : le fichier monté présente un token inconnu → DOWN avec 401.
  writeFileSync(join(dir, 'collector-token'), 'token-non-provisionne-0123456789abcdef\n', { mode: 0o600 });
  await until(async () => {
    const [t] = await apiTargets();
    return t.health === 'down' && /401/.test(t.lastError ?? '');
  }, 'target DOWN avec HTTP 401 sur token non provisionné');

  // Rotation : nouveau couple, liste transitoire des deux digests, API redéployée seule.
  const rotated = await provisionToken('rotated');
  writeFileSync(join(dir, 'collector-token'), `${rotated.token}\n`, { mode: 0o600 });
  await stopApi();
  await startApi(`${rotated.digest},${first.digest}`);
  await until(async () => (await apiTargets())[0]?.health === 'up', 'target UP avec le nouveau token (rotation appliquée sans recompiler)');
  const legacy = await fetch(`http://127.0.0.1:${apiPort}/api/v1/metrics`, { headers: { authorization: `Bearer ${first.token}` } });
  assert.equal(legacy.status, 200, "pendant la fenêtre de grâce, l'ancien digest accepte encore l'ancien token");

  // Révocation : l'ancien digest sort de la liste → coupé partout, admin intact.
  await stopApi();
  await startApi(rotated.digest);
  await until(async () => {
    const [t] = await apiTargets();
    return t.health === 'down' && /401/.test(t.lastError ?? '');
  }, 'target DOWN après retrait du digest (révocation visible par le serveur réel)');
  const old = await fetch(`http://127.0.0.1:${apiPort}/api/v1/metrics`, { headers: { authorization: `Bearer ${first.token}` } });
  assert.equal(old.status, 401, 'token révoqué : refus direct aussi');
  const login = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'h2k-stack@test.invalid', password }) });
  assert.equal(login.status, 200);
  const adminToken = (await login.json()).access_token;
  const admin = await fetch(`http://127.0.0.1:${apiPort}/api/v1/metrics`, { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(admin.status, 200, 'voie H2j (administrateur) intacte après révocation du collecteur');
  const anon = await fetch(`http://127.0.0.1:${apiPort}/api/v1/metrics`);
  assert.equal(anon.status, 401, 'aucun repli public après révocation');

  // Hygiène : aucun secret inline dans la config montée, aucun token dans les logs.
  const mountedConfig = readFileSync(join(dir, 'prometheus.yml'), 'utf8');
  assert.equal(/(username|password|bearer_token)\s*:/.test(mountedConfig), false, 'aucun secret inline dans la config Prometheus');
  assert.equal(mountedConfig.includes(rotated.token), false, 'la config ne contient jamais le token brut');
  assert.equal(mountedConfig.includes(first.token), false);
  const serverLogs = readPromLogs();
  assert.equal(serverLogs.includes(rotated.token), false, "le token n'apparaît pas dans les logs du serveur");
  assert.equal(serverLogs.includes(first.token), false);

  console.log('✓ H2k STACK : vrai serveur Prometheus sur la config livrée — UP avec credentials_file, série requêtable = COUNT SQL réel, DOWN 401 sur token non provisionné, rotation et révocation qualifiées par ingestion réelle, voie admin H2j intacte, aucun secret dans config montée ni logs. Gate E2 (exporter SQL) non modifié.');
} catch (error) {
  // G5 diagnostic : les rejets de top-level await court-circuitent
  // 'unhandledRejection' (Node ≥ 15) — c'est ici que la cause précise est
  // publiée en annotation GitHub (tronquée, sans secret), puis relancée
  // inchangée pour le log complet du job. Le catch ne masque rien.
  const detail = String(error?.message ?? error).replace(/\r?\n/g, ' | ').slice(0, 900);
  if (process.env.GITHUB_ACTIONS === 'true') writeSync(2, `::error title=H2k stack::${detail}\n`);
  throw error;
} finally {
  if (promProcess && promProcess.exitCode === null) promProcess.kill('SIGTERM');
  if (useDocker) {
    try {
      const logs = spawnSync('docker', ['logs', dockerName], { encoding: 'utf8' });
      writeFileSync(join(dir, `${dockerName}.log`), (logs.stdout ?? '') + (logs.stderr ?? ''));
    } catch { /* best effort */ }
    spawnSync('docker', ['rm', '-f', dockerName], { stdio: 'ignore' });
  }
  await stopApi().catch(() => undefined);
  await app.end().catch(() => undefined);
  await db.end().catch(() => undefined);
  console.log(`Logs H2k : ${dir} (fixtures synthétiques uniquement)`);
}
