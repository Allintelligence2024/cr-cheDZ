#!/usr/bin/env node
/** Gate D local/CI. DESTRUCTIF : cluster dédié, base *_test uniquement.
 * Fixtures/inspection : DATABASE_URL administrateur.
 * DDL/seeds : creche_migrator. HTTP/worker/RLS : creche_app.
 * Les helpers ne créent aucun rôle et n'ajoutent aucun grant en ce mode.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (process.env.ALLOW_DATABASE_RESET !== '1' || !process.env.DATABASE_URL) {
  throw new Error('Base jetable dédiée : DATABASE_URL et ALLOW_DATABASE_RESET=1 requis');
}
const adminUrl = new URL(process.env.DATABASE_URL);
if (!decodeURIComponent(adminUrl.pathname).endsWith('_test')) {
  throw new Error('Gate destructif réservé aux bases dont le nom se termine par _test');
}
const appPassword = randomBytes(32).toString('hex');
const migratorPassword = randomBytes(32).toString('hex');
function url(role, password) {
  const u = new URL(adminUrl); u.username = role; u.password = password; return u.toString();
}
const env = {
  ...process.env,
  NODE_ENV: 'test',
  BOOTSTRAP_DATABASE_URL: adminUrl.toString(),
  APP_DATABASE_PASSWORD: appPassword,
  MIGRATOR_DATABASE_PASSWORD: migratorPassword,
  MIGRATION_DATABASE_URL: url('creche_migrator', migratorPassword),
  APP_DATABASE_URL: url('creche_app', appPassword),
  PRODUCTION_ROLE_TESTS: '1',
  ISOLATION_LOG_DIR: mkdtempSync(join(tmpdir(), 'creche-roles-gate-')),
};
function run(command, args, overrides = {}) {
  const result = spawnSync(command, args, { env: { ...env, ...overrides }, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Gate D interrompu : ${command} ${args.join(' ')} (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}
// H1 is independent: collect its failure but still run the sync regressions.
let stagingFailed = false;
// Never the API test cluster.
if (env.GITHUB_ACTIONS === 'true' || env.RUN_STAGING_STACK === '1') {
  const staging = spawnSync(process.execPath, ['scripts/test-staging-stack.mjs'], { env, stdio: 'inherit' });
  stagingFailed = !!staging.error || staging.status !== 0;
} else { console.log('H1 staging NOT EXECUTED locally (Docker required).'); }
// F2 first: compile/run the real Flutter client, not just the wire fixture.
if (env.GITHUB_ACTIONS === 'true' || env.RUN_STAFF_SYNC === '1') {
  run(process.execPath, ['scripts/check-staff-sync.mjs']);
}
run(process.execPath, ['--test', 'tests/tenant-isolation/production-compose-contract.test.mjs']);
run(process.execPath, ['--test', 'tests/monitoring/worker-monitoring.test.mjs', 'tests/monitoring/alert-routing.test.mjs', 'tests/monitoring/alert-relay.test.mjs']);
run(process.execPath, ['--test', 'tests/tenant-isolation/phase26-production-roles.test.mjs']);
// La suite de régression injecte des rôles dangereux. Rebootstrap des secrets
// et reset du schéma AVANT les suites historiques (phase3/4 attendent du neuf).
run(process.execPath, ['scripts/bootstrap-roles.mjs']);
run(process.execPath, ['scripts/migrate.mjs', '--reset']);
run(process.execPath, ['scripts/migrate.mjs']);
run(process.execPath, ['scripts/seed.mjs']);
// F4 uses the live API and real Flutter engine, before the long historical suites.
if (env.GITHUB_ACTIONS === 'true' || env.RUN_SYNC_E2E === '1') {
  run(process.execPath, ['scripts/test-sync-api-flutter.mjs']);
  run(process.execPath, ['scripts/migrate.mjs', '--reset']);
  run(process.execPath, ['scripts/migrate.mjs']);
  run(process.execPath, ['scripts/seed.mjs']);
} else {
  console.log('F4 non exécuté localement (SDK absent) ; obligatoire sur GitHub.');
}
// Retour rapide sur le gate E2 réseau AVANT les suites API longues.
if (env.GITHUB_ACTIONS === 'true' || env.RUN_MONITORING_STACK === '1') {
  run(process.execPath, ['scripts/test-worker-monitoring-stack.mjs']);
  // Le test d'alerte vieillit les ticks : restaurer du neuf pour phase3/4.
  run(process.execPath, ['scripts/migrate.mjs', '--reset']);
  run(process.execPath, ['scripts/migrate.mjs']);
  run(process.execPath, ['scripts/seed.mjs']);
}
// Fail early on both sides of the wire contract. Dart runs in Docker on GitHub.
run(process.execPath, ['scripts/check-sync-contract.mjs', ...(env.GITHUB_ACTIONS === 'true' || env.RUN_SYNC_DART === '1' ? [] : ['--node-only'])]);
console.log(`Logs isolation : ${env.ISOLATION_LOG_DIR}`);
run('bash', ['scripts/run-isolation-suites.sh']);
console.log('✓ GATE D : régressions Phase D + 37 suites/contrôles (E1–E6 incluses) avec rôles et grants de production.');

if (stagingFailed) { console.error('H1 staging failed; overall gate remains RED.'); process.exit(1); }

// F0 is archived evidence of the previous protocol, not a permanent bug gate.
// Positive F1/F3 regressions now run as phase29 in the isolation battery.
