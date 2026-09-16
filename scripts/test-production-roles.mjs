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
run(process.execPath, ['--test', 'tests/tenant-isolation/ci-notice-budget.test.mjs', 'tests/tenant-isolation/registry-pull.test.mjs', 'tests/tenant-isolation/dev-compose-contract.test.mjs', 'tests/tenant-isolation/dev-proxy.test.mjs', 'tests/tenant-isolation/openapi-contract.test.mjs']);
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
  // H2k : ingestion réelle du scrape API (vrai Prometheus, config livrée).
  run(process.execPath, ['scripts/test-metrics-collector-stack.mjs']);
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
console.log(`H2a confidentiality passed: ${confidentiality[1]} real HTTP/PostgreSQL scenarios passed: journal notification creation and rights-export authorization/projections. Not provider delivery or post-queue revocation qualification.`);
const revocation = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase36-notification-revocation.api.test.log'), 'utf8')
  .match(/H2b notifications: (\d+) passed, 0 failed/);
if (!revocation || Number(revocation[1]) < 50) throw new Error('H2b notification evidence missing or incomplete');
console.log(`H2b notifications passed: ${revocation[1]} real API/PostgreSQL/worker scenarios passed, with loopback HTTP provider doubles. Rights rechecked after claim, inbox filtered before LIMIT, consumed refusals retained with reasons. Not a live FCM/APNs/Meta qualification or recall of delivered messages.`);
const parentAccess = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase37-parent-revocation.api.test.log'), 'utf8')
  .match(/H2c parent access: (\d+) passed, 0 failed/);
if (!parentAccess || Number(parentAccess[1]) < 156) throw new Error('H2c parent access evidence missing or incomplete');
console.log(`H2c parent access passed: ${parentAccess[1]} real HTTP/PostgreSQL scenarios passed on 13 child-scoped parent routes. Current guardian/child/user/membership checked; capabilities stay separate; refused writes do not mutate business records. Not global JWT revocation, field-projection review or recall of signed URLs.`);
const financialProjection = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase38-parent-financial-projection.api.test.log'), 'utf8')
  .match(/H2d financial projection: (\d+) passed, 0 failed/);
if (!financialProjection || Number(financialProjection[1]) < 44) throw new Error('H2d financial projection evidence missing or incomplete');
console.log(`H2d financial projection passed: ${financialProjection[1]} real HTTP/PostgreSQL scenarios passed: public financial field allowlists, HMAC-signed initialization against a loopback gateway, raw response kept internal, authorized PDF and accounting views retained. Not real SATIM qualification, historical purge or full confidentiality closure.`);
const journalHealth = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase39-journal-health-disclosure.api.test.log'), 'utf8')
  .match(/H2e journal health: (\d+) passed, 0 failed/);
if (!journalHealth || Number(journalHealth[1]) < 36) throw new Error('H2e journal health evidence missing or incomplete');
console.log(`H2e journal health passed: ${journalHealth[1]} real HTTP/PostgreSQL scenarios passed: temperature and health_observation require health capability in parent feed and new rights exports; filtering before LIMIT; authorized health and ordinary journal retained. Not snapshot purge, global JWT revocation or arbitrary text classification.`);
const privacyActor = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase40-privacy-actor-revocation.api.test.log'), 'utf8')
  .match(/H2f privacy actor: (\d+) passed, 0 failed/);
if (!privacyActor || Number(privacyActor[1]) < 156) throw new Error('H2f privacy actor evidence missing or incomplete');
console.log(`H2f privacy actor passed: ${privacyActor[1]} real HTTP/PostgreSQL scenarios passed: active non-deleted user and active tenant membership required for rights-request creation, list, detail, export and resolution. Denied writes preserve business state; active requesters keep own history after guardian deletion. Not global JWT/role revocation or historical snapshot purge.`);
const photoConsent = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase41-photo-consent-scope.api.test.log'), 'utf8')
  .match(/H2g photo consent: (\d+) passed, 0 failed/);
if (!photoConsent || Number(photoConsent[1]) < 58) throw new Error('H2g photo consent evidence missing or incomplete');
console.log(`H2g photo consent passed: ${photoConsent[1]} real HTTP/PostgreSQL scenarios passed: shared publication/parent-signing consent perimeter includes primary child, deduplicates participants and refuses unverifiable metadata. Authorized photos and staff access retained. Local signatures only, not image-content recognition, live storage delivery or signed-URL recall.`);
const staffDocuments = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase42-staff-document-scope.api.test.log'), 'utf8')
  .match(/H2h staff document scope: (\d+) passed, 0 failed/);
if (!staffDocuments || Number(staffDocuments[1]) < 32) throw new Error('H2h staff document evidence missing or incomplete');
console.log(`H2h staff document scope passed: ${staffDocuments[1]} real HTTP/PostgreSQL scenarios passed: tenant-prefix guard shared with media, refused staff-document writes leave documents and audit unchanged. Existing role/RLS and minimized reads retained. Not object existence, storage download, historical rewrite or global role revocation qualification.`);
// All subprocesses share one workflow step (ten notices maximum). Keep full
// per-lot details in stdout, but aggregate H2 so later lots are not silently lost.
const storageSelection = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase49-storage-selection.test.log'), 'utf8')
  .match(/H2i storage selection: (\d+) passed, 0 failed/);
if (!storageSelection || Number(storageSelection[1]) < 48) throw new Error('H2i storage selection evidence missing or incomplete');
console.log(`H2i storage selection passed: ${storageSelection[1]} config/service, real entrypoint/PG and filesystem/loopback HTTP scenarios: common backend selection, early refusal of ambiguous production storage and missing selected-S3 credentials, valid local/S3 startup retained. Not real S3 service qualification, media-local support, encryption or production deployment.`);
const metricsEvidence = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase50-metrics.api.test.log'), 'utf8')
  .match(/H2j metrics: (\d+) passed, 0 failed/);
if (!metricsEvidence || Number(metricsEvidence[1]) < 26) throw new Error('H2j metrics evidence missing or incomplete');
const collectorEvidence = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase51-metrics-collector.api.test.log'), 'utf8')
  .match(/H2k metrics collector: (\d+) passed, 0 failed/);
if (!collectorEvidence || Number(collectorEvidence[1]) < 24) throw new Error('H2k metrics collector evidence missing or incomplete');
const anonymizationEvidence = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase52-anonymization.pg.test.log'), 'utf8')
  .match(/H2l anonymization: (\d+) passed, 0 failed/);
if (!anonymizationEvidence || Number(anonymizationEvidence[1]) < 14) throw new Error('H2l anonymization evidence missing or incomplete');
console.log(`H2l anonymization passed: ${anonymizationEvidence[1]} whole-database canary-scan, no-purge, referential, deterministic-rewrite, real-login, idempotence, transactional self-check and DB-name guard scenarios on scripts/anonymize.sql. Storage-object binaries and vendor-side deliveries remain explicitly out of scope.`);
console.log(`H2k metrics collector passed: ${collectorEvidence[1]} real HTTP/PG, shared-config, provisioning-tool and delivered-configuration scenarios: provisioned collector digest scrapes with zero user authority, refusal/revocation/rotation via digest list only, tenant and anonymous paths unchanged, no inline secret in Prometheus config, no raw token in API env, read-only secret mount.`);
console.log(`H2j metrics passed: ${metricsEvidence[1]} real HTTP/PG and official Prometheus client parser scenarios: current platform administrator, no anonymous/tenant access, bounded unmatched-route labels, escaped labels, complete ordered histograms. Global JWT revocation remains unqualified; operational scraper credential is covered separately by H2k.`);
console.log(`::notice title=H2 confidentiality passed::H2a=${confidentiality[1]}; H2b=${revocation[1]}; H2c=${parentAccess[1]}; H2d=${financialProjection[1]}; H2e=${journalHealth[1]}; H2f=${privacyActor[1]}; H2g=${photoConsent[1]}; H2h=${staffDocuments[1]}; H2i=${storageSelection[1]}; H2j=${metricsEvidence[1]}; H2k=${collectorEvidence[1]}; H2l=${anonymizationEvidence[1]}. All HTTP/PostgreSQL and config/entrypoint/storage scenario thresholds verified, zero failures. Local provider doubles/signatures only; no global JWT revocation, signed-URL recall or production qualification. Per-lot details remain in the job log and runbooks.`);
const authHardening = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase43-auth-hardening.api.test.log'), 'utf8')
  .match(/G1 auth hardening: (\d+) passed, 0 failed/);
if (!authHardening || Number(authHardening[1]) < 26) throw new Error('G1 auth evidence missing or incomplete');
console.log(`G1 auth hardening passed: ${authHardening[1]} HTTP/PostgreSQL scenarios passed: parent status and lockout, atomic failure counters and OTP consumption, generic wrong-secret errors, numeric bcrypt config, separate client limits behind a single overwriting proxy. Not global JWT/role revocation, refresh/invitation race or public direct-API deployment qualification.`);
const rlsIntegrity = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase44-rls-integrity.pg.test.log'), 'utf8')
  .match(/G2 RLS integrity: (\d+) passed, 0 failed/);
if (!rlsIntegrity || Number(rlsIntegrity[1]) < 113) throw new Error('G2 RLS integrity evidence missing or incomplete');
console.log(`G2 RLS integrity passed: ${rlsIntegrity[1]} application-role PostgreSQL scenarios: global rows read-only to ordinary DML, empty pooled tenant context safe, same-payment allocations serialized. Explicit privileged helpers retained; not a review of their complete authority or all financial mutation paths.`);
const dpiaApproval = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase45-dpia-approval.api.test.log'), 'utf8')
  .match(/G3 DPIA approval: (\d+) passed, 0 failed/);
if (!dpiaApproval || Number(dpiaApproval[1]) < 33) throw new Error('G3 DPIA evidence missing or incomplete');
console.log(`G3 DPIA approval passed: ${dpiaApproval[1]} HTTP/PostgreSQL scenarios: independent active reviewers, current privileged membership, atomic minimized audit, stable retries and overlapping approvals. Not global JWT revocation, historical approval remediation or production qualification.`);
const refreshRotation = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase46-refresh-rotation.api.test.log'), 'utf8')
  .match(/G1b refresh rotation: (\d+) passed, 0 failed/);
if (!refreshRotation || Number(refreshRotation[1]) < 24) throw new Error('G1b refresh evidence missing or incomplete');
console.log(`G1b refresh rotation passed: ${refreshRotation[1]} HTTP/PostgreSQL scenarios: serialized same-user refresh/replay, session state reloaded after locks, atomic replacement and rollback on storage failure. Existing all-session reuse policy retained; not global access-JWT revocation, device binding or every concurrent revocation path.`);
const invitations = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase47-invitations.api.test.log'), 'utf8')
  .match(/G1c invitations: (\d+) passed, 0 failed/);
if (!invitations || Number(invitations[1]) < 38) throw new Error('G1c invitation evidence missing or incomplete');
console.log(`G1c invitations passed: ${invitations[1]} HTTP/PostgreSQL scenarios: scoped current creators, serialized pending-account acceptance with atomic audit/session, token handoff only in development; unavailable delivery fails before writes. Not real email delivery, token-specific reinvitation invalidation or global JWT revocation.`);
const totpManagement = readFileSync(join(env.ISOLATION_LOG_DIR, 'suite-phase48-totp-management.api.test.log'), 'utf8')
  .match(/G1d TOTP management: (\d+) passed, 0 failed/);
if (!totpManagement || Number(totpManagement[1]) < 44) throw new Error('G1d TOTP management evidence missing or incomplete');
console.log(`G1d TOTP management passed: ${totpManagement[1]} HTTP/PG and RFC-vector scenarios: no activated-secret disclosure, current account state after locks, serialized enrollment/confirmation/cancellation, strict audit rollback, shared failed-proof lockout and HTTP limits. Not encrypted-at-rest secrets, cross-channel MFA enforcement, one-time TOTP replay protection or global JWT revocation.`);
console.log(`::notice title=G security passed::G1=${authHardening[1]}; G1b=${refreshRotation[1]}; G1c=${invitations[1]}; G1d=${totpManagement[1]}; G2=${rlsIntegrity[1]}; G3=${dpiaApproval[1]}. All scenario thresholds verified with zero failures. G1 HTTP/proxy/PG, G1b atomic refresh rotation, G1c scoped invitations, G1d TOTP management and G2 application-role SQL and G3 independent DPIA approval/atomic audit, including overlapping transactions; not complete JWT/role revocation, privileged-helper authorization or production deployment qualification.`);
console.log('✓ GATE D : régressions Phase D + 55 suites/contrôles (E1–E6 incluses) avec rôles et grants de production.');

if (stackFailed) { console.error('H1 staging/dev failed; overall gate remains RED.'); process.exit(1); }

// F0 is archived evidence of the previous protocol, not a permanent bug gate.
// Positive F1/F3 regressions now run as phase29 in the isolation battery.
