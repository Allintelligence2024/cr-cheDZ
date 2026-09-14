#!/usr/bin/env node
/** Gate D local/CI. DESTRUCTIF : cluster dédié, base *_test uniquement.
 * Fixtures/inspection : DATABASE_URL administrateur.
 * DDL/seeds : creche_migrator. HTTP/worker/RLS : creche_app.
 * Les helpers ne créent aucun rôle et n'ajoutent aucun grant en ce mode.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
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
run(process.execPath, ['--test', 'tests/tenant-isolation/registry-pull.test.mjs', 'tests/tenant-isolation/dev-compose-contract.test.mjs', 'tests/tenant-isolation/dev-proxy.test.mjs']);
// Fast production-layout reproduction before the slower Docker/Flutter gates.
run(process.execPath, ['scripts/check-api-runtime.mjs']);
// H1 is independent: collect its failure but still run the sync regressions.
let stackFailed = false;
// Never the API test cluster.
if (env.GITHUB_ACTIONS === 'true' || env.RUN_STAGING_STACK === '1') {
  const staging = spawnSync(process.execPath, ['scripts/test-staging-stack.mjs'], { env, stdio: 'inherit' });
  stackFailed = !!staging.error || staging.status !== 0;
  const development = spawnSync(process.execPath, ['scripts/test-staging-stack.mjs', '--dev'], { env, stdio: 'inherit' });
  stackFailed = stackFailed || !!development.error || development.status !== 0;
} else { console.log('H1 staging/dev NOT EXECUTED locally (Docker required).'); }
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
const confidentiality = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase35-confidentiality.api.test.log'), 'utf8')
  .match(/H2 confidentiality: (\d+) passed, 0 failed/);
if (!confidentiality || Number(confidentiality[1]) < 21) throw new Error('H2a confidentiality evidence missing or incomplete');
console.log(`::notice title=H2a confidentiality passed::${confidentiality[1]} real HTTP/PostgreSQL scenarios passed: journal notification creation and rights-export authorization/projections. Not provider delivery or post-queue revocation qualification.`);
const revocation = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase36-notification-revocation.api.test.log'), 'utf8')
  .match(/H2b notifications: (\d+) passed, 0 failed/);
if (!revocation || Number(revocation[1]) < 50) throw new Error('H2b notification evidence missing or incomplete');
console.log(`::notice title=H2b notifications passed::${revocation[1]} real API/PostgreSQL/worker scenarios passed, with loopback HTTP provider doubles. Rights rechecked after claim, inbox filtered before LIMIT, consumed refusals retained with reasons. Not a live FCM/APNs/Meta qualification or recall of delivered messages.`);
const parentAccess = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase37-parent-revocation.api.test.log'), 'utf8')
  .match(/H2c parent access: (\d+) passed, 0 failed/);
if (!parentAccess || Number(parentAccess[1]) < 156) throw new Error('H2c parent access evidence missing or incomplete');
console.log(`::notice title=H2c parent access passed::${parentAccess[1]} real HTTP/PostgreSQL scenarios passed on 13 child-scoped parent routes. Current guardian/child/user/membership checked; capabilities stay separate; refused writes do not mutate business records. Not global JWT revocation, field-projection review or recall of signed URLs.`);
const financialProjection = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase38-parent-financial-projection.api.test.log'), 'utf8')
  .match(/H2d financial projection: (\d+) passed, 0 failed/);
if (!financialProjection || Number(financialProjection[1]) < 44) throw new Error('H2d financial projection evidence missing or incomplete');
console.log(`::notice title=H2d financial projection passed::${financialProjection[1]} real HTTP/PostgreSQL scenarios passed: public financial field allowlists, HMAC-signed initialization against a loopback gateway, raw response kept internal, authorized PDF and accounting views retained. Not real SATIM qualification, historical purge or full confidentiality closure.`);
const journalHealth = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase39-journal-health-disclosure.api.test.log'), 'utf8')
  .match(/H2e journal health: (\d+) passed, 0 failed/);
if (!journalHealth || Number(journalHealth[1]) < 36) throw new Error('H2e journal health evidence missing or incomplete');
console.log(`::notice title=H2e journal health passed::${journalHealth[1]} real HTTP/PostgreSQL scenarios passed: temperature and health_observation require health capability in parent feed and new rights exports; filtering before LIMIT; authorized health and ordinary journal retained. Not snapshot purge, global JWT revocation or arbitrary text classification.`);
const privacyActor = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase40-privacy-actor-revocation.api.test.log'), 'utf8')
  .match(/H2f privacy actor: (\d+) passed, 0 failed/);
if (!privacyActor || Number(privacyActor[1]) < 156) throw new Error('H2f privacy actor evidence missing or incomplete');
console.log(`::notice title=H2f privacy actor passed::${privacyActor[1]} real HTTP/PostgreSQL scenarios passed: active non-deleted user and active tenant membership required for rights-request creation, list, detail, export and resolution. Denied writes preserve business state; active requesters keep own history after guardian deletion. Not global JWT/role revocation or historical snapshot purge.`);
const photoConsent = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase41-photo-consent-scope.api.test.log'), 'utf8')
  .match(/H2g photo consent: (\d+) passed, 0 failed/);
if (!photoConsent || Number(photoConsent[1]) < 58) throw new Error('H2g photo consent evidence missing or incomplete');
console.log(`::notice title=H2g photo consent passed::${photoConsent[1]} real HTTP/PostgreSQL scenarios passed: shared publication/parent-signing consent perimeter includes primary child, deduplicates participants and refuses unverifiable metadata. Authorized photos and staff access retained. Local signatures only, not image-content recognition, live storage delivery or signed-URL recall.`);
console.log('✓ GATE D : régressions Phase D + 44 suites/contrôles (E1–E6 incluses) avec rôles et grants de production.');

if (stackFailed) { console.error('H1 staging/dev failed; overall gate remains RED.'); process.exit(1); }

// F0 is archived evidence of the previous protocol, not a permanent bug gate.
// Positive F1/F3 regressions now run as phase29 in the isolation battery.
