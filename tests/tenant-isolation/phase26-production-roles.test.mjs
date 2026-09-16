#!/usr/bin/env node
// Destructif UNIQUEMENT sur une base jetable explicitement autorisée.
// Ne jamais pointer ces tests vers une sauvegarde restaurée de données réelles.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';

assert.equal(process.env.ALLOW_DATABASE_RESET, '1', 'Base jetable : ALLOW_DATABASE_RESET=1 requis');
const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'), 'Base *_test dédiée requise');
const admin = new pg.Client({ connectionString: adminUrl });
const roles = () => readFileSync('infrastructure/database/roles.sql', 'utf8');
const roleUrl = (name) => { const u = new URL(adminUrl); u.username = name; u.password = 'phase-d-local-only-password'; return u.toString(); };
const migrate = (url, ...args) => spawnSync(process.execPath, ['scripts/migrate.mjs', ...args], {
  env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: url, MIGRATION_DATABASE_URL: url }, encoding: 'utf8', timeout: 30000,
});

before(async () => {
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await admin.query(roles());
  // Fixture : rôle existant dangereux, cas C8-bis. Aucun objet ne lui appartient.
  await admin.query('ALTER ROLE creche_app SUPERUSER BYPASSRLS CREATEDB CREATEROLE REPLICATION');
});
after(async () => { await admin.end(); });

test('D1 : roles.sql durcit aussi un rôle existant et reste idempotent', async () => {
  await admin.query(roles());
  await admin.query(roles());
  const { rows: [r] } = await admin.query("SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname='creche_app'");
  assert.deepEqual(r, { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
});

test('D2 : provider API refuse une connexion superuser en production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = adminUrl;
  const { databaseProvider } = await import('../../apps/api/dist/shared/database/database.provider.js');
  let pool;
  try {
    await assert.rejects(async () => { pool = await databaseProvider.useFactory(); }, /DATABASE_ROLE_UNSAFE/);
  } finally { if (pool) await pool.end(); }
});

test('D2 : migrate refuse le rôle applicatif AVANT tout DDL', async () => {
  // Ancien runner : superuser applicatif accepte --check et crée schema_migrations.
  await admin.query("ALTER ROLE creche_app LOGIN PASSWORD 'phase-d-local-only-password'");
  const result = migrate(roleUrl('creche_app'), '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /MIGRATION_ROLE_UNSAFE/);
  assert.equal((await admin.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger, null);
});

test('D3 : table nouvelle du migrateur lisible sans GRANT manuel', async () => {
  // Préparation du droit DDL (le bootstrap le fournit après correction).
  await admin.query('GRANT CREATE ON SCHEMA public TO creche_migrator');
  await admin.query("ALTER ROLE creche_migrator LOGIN PASSWORD 'phase-d-local-only-password'");
  const ddl = new pg.Client({ connectionString: roleUrl('creche_migrator') });
  const app = new pg.Client({ connectionString: roleUrl('creche_app') });
  await ddl.connect(); await app.connect();
  try {
    // Ne pas laisser le superuser de la fixture masquer l'absence de grants.
    await admin.query('ALTER ROLE creche_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
    await ddl.query('CREATE TABLE phase_d_grants_probe (id integer)');
    await ddl.query('INSERT INTO phase_d_grants_probe VALUES (1)');
    assert.deepEqual((await app.query('SELECT * FROM phase_d_grants_probe')).rows, [{ id: 1 }]);
  } finally {
    await ddl.query('DROP TABLE IF EXISTS phase_d_grants_probe');
    await ddl.end(); await app.end();
  }
});

const productionEnv = (url) => ({
  ...process.env, NODE_ENV: 'production', DATABASE_URL: url, APP_PORT: '0',
  JWT_SECRET: 'phase-d-only-jwt-secret-32-characters-minimum',
  PAYMENT_WEBHOOK_SECRET: 'phase-d-only-webhook-secret-32-characters',
  // G5 : la garde production exige désormais la clé de chiffrement des secrets
  // TOTP — fixture synthétique au format attendu (32 octets hex).
  TOTP_ENCRYPTION_KEY: 'a'.repeat(64),
  STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/tmp/phase-d-storage',
  SENTRY_DSN: '', FIREBASE_SERVICE_ACCOUNT_JSON: '',
});

async function assertProviderRejected() {
  const { databaseProvider } = await import('../../apps/api/dist/shared/database/database.provider.js');
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = roleUrl('creche_app');
  let pool;
  try { await assert.rejects(async () => { pool = await databaseProvider.useFactory(); }, /DATABASE_ROLE_UNSAFE/); }
  finally { if (pool) await pool.end(); }
}

test('D2 : BYPASSRLS sans SUPERUSER est refusé', async () => {
  await admin.query('ALTER ROLE creche_app BYPASSRLS');
  try { await assertProviderRejected(); }
  finally { await admin.query('ALTER ROLE creche_app NOBYPASSRLS'); }
});

test('D2 : appartenance au migrateur refusée même sans héritage automatique', async () => {
  await admin.query('GRANT creche_migrator TO creche_app WITH INHERIT FALSE');
  try { await assertProviderRejected(); }
  finally { await admin.query('REVOKE creche_migrator FROM creche_app'); }
});

test('D1/D2 : propriétaire applicatif refusé par bootstrap et API', async () => {
  await admin.query('CREATE TABLE phase_d_owner_probe (id integer); ALTER TABLE phase_d_owner_probe OWNER TO creche_app');
  try {
    await assertProviderRejected();
    await assert.rejects(admin.query(roles()), /DATABASE_ROLE_OWNS_OBJECTS/);
  } finally { await admin.query('DROP TABLE phase_d_owner_probe'); }
});

test('D2 : un login administrateur masqué par SET ROLE reste refusé', async () => {
  const { assertApplicationDatabaseRole } = await import('@creche/prod-config');
  await admin.query('SET ROLE creche_app');
  try { await assert.rejects(assertApplicationDatabaseRole(admin, { NODE_ENV: 'production' }), /DATABASE_ROLE_UNSAFE/); }
  finally { await admin.query('RESET ROLE'); }
});

test('D2 : CREATE sur public refusé, rôle sain accepté', async () => {
  await admin.query('GRANT CREATE ON SCHEMA public TO creche_app');
  try { await assertProviderRejected(); }
  finally { await admin.query('REVOKE CREATE ON SCHEMA public FROM creche_app'); }
  const { databaseProvider } = await import('../../apps/api/dist/shared/database/database.provider.js');
  const pool = await databaseProvider.useFactory();
  try { assert.equal((await pool.query('SELECT current_user')).rows[0].current_user, 'creche_app'); }
  finally { await pool.end(); }
});

test('D2 : vrais entrypoints API ET worker sortent en erreur, avant de servir/claim', () => {
  for (const entry of ['apps/api/dist/main.js', 'apps/worker/dist/main.js']) {
    const result = spawnSync(process.execPath, [entry], {
      env: productionEnv(adminUrl), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stderr + result.stdout, /DATABASE_ROLE_UNSAFE/);
    assert.doesNotMatch(result.stdout, /API prête|\[worker\] démarré/);
  }
});

test('D2 : migrateur superuser et --reset production refusés', async () => {
  let result = migrate(roleUrl('creche_migrator'), '--reset');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_RESET_FORBIDDEN/);
  await admin.query('ALTER ROLE creche_migrator SUPERUSER');
  try {
    result = migrate(roleUrl('creche_migrator'), '--check');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MIGRATION_ROLE_UNSAFE/);
  } finally { await admin.query('ALTER ROLE creche_migrator NOSUPERUSER'); }
});

test('D3 : vraie migration supplémentaire + réparation grants sur run sans DDL', async () => {
  // Copie jetable du runner et des migrations : AUCUN fichier 001–052 modifié,
  // AUCUN numéro de migration de production réservé pour cette table fictive.
  const tmp = mkdtempSync(join(process.cwd(), 'node_modules', '.phase-d-'));
  mkdirSync(join(tmp, 'scripts'));
  for (const f of ['migrate.mjs', 'migration-connection.mjs']) cpSync(`scripts/${f}`, join(tmp, 'scripts', f));
  cpSync('infrastructure/database', join(tmp, 'infrastructure/database'), { recursive: true });
  writeFileSync(join(tmp, 'infrastructure/database/migrations/999_test_only.sql'),
    'CREATE TABLE phase_d_migration_probe (id serial PRIMARY KEY); INSERT INTO phase_d_migration_probe DEFAULT VALUES;');
  const run = () => spawnSync(process.execPath, [join(tmp, 'scripts/migrate.mjs')], {
    env: { ...productionEnv(roleUrl('creche_app')), MIGRATION_DATABASE_URL: roleUrl('creche_migrator') },
    encoding: 'utf8', timeout: 30000,
  });
  const { databaseProvider } = await import('../../apps/api/dist/shared/database/database.provider.js');
  const app = await databaseProvider.useFactory();
  try {
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await app.query('SELECT * FROM phase_d_migration_probe')).rows, [{ id: 1 }]);
    await app.query('INSERT INTO phase_d_migration_probe DEFAULT VALUES');
    await admin.query('REVOKE SELECT ON phase_d_migration_probe FROM creche_app');
    await assert.rejects(app.query('SELECT * FROM phase_d_migration_probe'), { code: '42501' });
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Aucune migration en attente/);
    assert.equal((await app.query('SELECT * FROM phase_d_migration_probe')).rowCount, 2);
    await assert.rejects(app.query('DELETE FROM schema_migrations'), { code: '42501' });
    const { rows: badFunctions } = await admin.query(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef AND
       (p.proowner <> 'creche_migrator'::regrole OR NOT has_function_privilege('creche_app', p.oid, 'EXECUTE'))
    `);
    assert.deepEqual(badFunctions, [], 'SECURITY DEFINER : propriétaire migrateur + EXECUTE app');
  } finally {
    await app.end();
    await admin.query("DROP TABLE IF EXISTS phase_d_migration_probe; DELETE FROM schema_migrations WHERE filename='999_test_only.sql'");
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('D2 : API et worker démarrent réellement en production avec creche_app', async () => {
  for (const [entry, ready] of [['apps/api/dist/main.js', 'API prête'], ['apps/worker/dist/main.js', '[worker] démarré']]) {
    const child = spawn(process.execPath, [entry], { env: productionEnv(roleUrl('creche_app')), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Boot timeout : ${output}`)), 10000);
        const read = (chunk) => {
          output += chunk;
          if (output.includes(ready)) { clearTimeout(timer); resolve(); }
        };
        child.stdout.on('data', read); child.stderr.on('data', read);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Boot exit ${code} : ${output}`)); });
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        await ended;
      }
    }
  }
});


test('D1 : bootstrap secrets distincts, rejouable après migrations, sans fuite en sortie', () => {
  const env = {
    ...process.env, BOOTSTRAP_DATABASE_URL: adminUrl,
    APP_DATABASE_PASSWORD: 'phase-d-distinct-app-password-for-bootstrap',
    MIGRATOR_DATABASE_PASSWORD: 'phase-d-distinct-migrator-password-for-bootstrap',
  };
  const run = (overrides = {}) => spawnSync(process.execPath, ['scripts/bootstrap-roles.mjs'], {
    env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  let result = run({ MIGRATOR_DATABASE_PASSWORD: env.APP_DATABASE_PASSWORD });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_PASSWORD_UNSAFE/);
  for (let i = 0; i < 2; i++) {
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(`${result.stdout}${result.stderr}`).includes(env.APP_DATABASE_PASSWORD));
    assert.ok(!(`${result.stdout}${result.stderr}`).includes(env.MIGRATOR_DATABASE_PASSWORD));
  }
});
