#!/usr/bin/env node
/** H1: actual, isolated staging compose, synthetic data only. No published ports,
 * no external credentials, no paid notifications, no production deployment.
 * Build the delivered Dockerfiles; do not override staging service commands/mounts.
 */
import assert from 'node:assert/strict';
import { pullRegistryImage } from './registry-pull.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

assert.equal(process.env.ALLOW_DATABASE_RESET, '1', 'Disposable infrastructure only');
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('H1 NOT EXECUTED: Docker required'); process.exit(2);
}
const secret = () => randomBytes(32).toString('hex');
const appPassword = secret(), migratorPassword = secret();
const env = {
  // Deliberate allowlist: never inherit real provider/tenant credentials.
  PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST,
  POSTGRES_DB: 'creche_h1_test', POSTGRES_PASSWORD: secret(),
  APP_DATABASE_PASSWORD: appPassword, MIGRATOR_DATABASE_PASSWORD: migratorPassword,
  DATABASE_URL: `postgresql://creche_app:${appPassword}@postgres:5432/creche_h1_test`,
  MIGRATION_DATABASE_URL: `postgresql://creche_migrator:${migratorPassword}@postgres:5432/creche_h1_test`,
  JWT_SECRET: secret(), JWT_REFRESH_SECRET: secret(),
  MINIO_ROOT_USER: 'h1-synthetic', MINIO_ROOT_PASSWORD: secret(),
  CORS_ORIGINS: 'https://staging-test.invalid', WORKER_SCHEDULER_ENABLED: 'false',
};
const project = `creche-h1-${randomBytes(6).toString('hex')}`;
const prefix = ['compose', '--env-file', '/dev/null', '-p', project, '-f', resolve('infrastructure/docker/docker-compose.staging.yml')];
function docker(args, { timeout = 600000, quiet = false } = {}) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if (!quiet) { process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); }
  if (result.status !== 0) {
    let details = `${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-12000);
    for (const value of [appPassword, migratorPassword, env.POSTGRES_PASSWORD, env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.MINIO_ROOT_PASSWORD]) details = details.replaceAll(value, '[redacted]');
    for (let n = 0; n < details.length; n += 2000) console.error(`::error title=H1 command ${n / 2000 + 1}::` + details.slice(n, n + 2000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  }
  assert.equal(result.status, 0, `Docker command failed: ${args.slice(0,3).join(' ')}`);
  return result.stdout.trim();
}
const compose = (args, options) => docker([...prefix, ...args], options);
async function until(fn, label) {
  const end = Date.now() + 90000;
  while (Date.now() < end) { if (fn()) return; await delay(500); }
  throw new Error(`H1 timeout: ${label}`);
}
const sql = (query) => compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', env.POSTGRES_DB, '-v', 'ON_ERROR_STOP=1', '-Atc', query], { quiet: true, timeout: 10000 });
try {
  for (const target of ['api', 'worker']) docker(['build', '-f', `apps/${target}/Dockerfile`, '-t', `ghcr.io/creche-saas/${target}:staging`, '.']);
  const config = JSON.parse(compose(['config', '--format', 'json'], { quiet: true }));
  for (const name of ['postgres', 'minio']) process.stdout.write(await pullRegistryImage(config.services[name].image, { env }));
  compose(['up', '-d', '--pull', 'never', 'api', 'worker', 'minio']);
  // Readiness is functional, not just a running PID or a made-up health label.
  await until(() => {
    const r = spawnSync('docker', [...prefix, 'exec', '-T', 'api', 'node', '-e',
      "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"], { env, timeout: 5000, stdio: 'ignore' });
    return r.status === 0;
  }, 'API responds to HTTP health');
  assert.match(compose(['logs', 'migrate']), /OK|✓/);
  assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='creche_app' AND NOT rolsuper AND NOT rolbypassrls"), '1');
  // Genuine worker claim/finish through production functions. No real payments.
  const job = randomUUID();
  sql(`INSERT INTO background_jobs(id,job_type,payload) VALUES('${job}','payments_expire','{}')`);
  await until(() => sql(`SELECT status FROM background_jobs WHERE id='${job}'`) === 'done', 'worker executes synthetic job');
  assert.equal(sql(`SELECT attempts FROM background_jobs WHERE id='${job}'`), '1');
  assert.equal(sql('SELECT count(*) FROM organizations'), '0', 'No real/demo tenant data allowed');
  const services = compose(['ps', '--format', 'json'], { quiet: true }).split('\n').filter(Boolean).map(JSON.parse);
  for (const name of ['api', 'worker']) assert.equal(services.find(s => s.Service === name)?.State, 'running');
  console.log('::notice title=H1 staging passed::Delivered staging compose: bootstrap roles, migration, seed, schema-check completed; actual API HTTP health and worker claim/finish verified. Synthetic isolated stack only. No production deployment, no Phase G or H2/H3 qualification.');
} catch (error) {
  let failure = String(error.stack ?? error);
  for (const value of [appPassword, migratorPassword, env.POSTGRES_PASSWORD, env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.MINIO_ROOT_PASSWORD]) failure = failure.replaceAll(value, '[redacted]');
  console.error('::error title=H1 failure::' + failure.slice(-4000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  // Container logs may include connection errors: redact generated secrets.
  const result = spawnSync('docker', [...prefix, 'logs', '--tail', '80'], { env, encoding: 'utf8' });
  let text = (result.stdout ?? '') + (result.stderr ?? '');
  for (const value of [appPassword, migratorPassword, env.POSTGRES_PASSWORD, env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.MINIO_ROOT_PASSWORD]) text = text.replaceAll(value, '[redacted]');
  for (let n = 0; n < text.length; n += 2000) console.error(`::error title=H1 staging ${n / 2000 + 1}::` + text.slice(n, n + 2000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  throw error;
} finally {
  compose(['down', '--volumes', '--remove-orphans'], { timeout: 90000 });
}
