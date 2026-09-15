#!/usr/bin/env node
// Administrateur uniquement. Idempotent, transactionnel, aucun secret en sortie.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.BOOTSTRAP_DATABASE_URL;
const appPassword = process.env.APP_DATABASE_PASSWORD;
const migratorPassword = process.env.MIGRATOR_DATABASE_PASSWORD;
if (!url || !appPassword || !migratorPassword) {
  throw new Error('BOOTSTRAP_DATABASE_URL, APP_DATABASE_PASSWORD, MIGRATOR_DATABASE_PASSWORD requis');
}
const adminPassword = decodeURIComponent(new URL(url).password);
if (appPassword.length < 16 || migratorPassword.length < 16 ||
    new Set([adminPassword, appPassword, migratorPassword]).size !== 3) {
  throw new Error('DATABASE_PASSWORD_UNSAFE: trois secrets distincts, app/migrateur >=16 caractères');
}
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('../infrastructure/database/roles.sql', import.meta.url), 'utf8'));
  await client.query("SELECT set_config('bootstrap.app_password', $1, true), set_config('bootstrap.migrator_password', $2, true)", [appPassword, migratorPassword]);
  await client.query(`DO $$ BEGIN
    EXECUTE format('ALTER ROLE creche_app PASSWORD %L', current_setting('bootstrap.app_password'));
    EXECUTE format('ALTER ROLE creche_migrator PASSWORD %L', current_setting('bootstrap.migrator_password'));
  END $$`);
  await client.query('COMMIT');
  console.log('✓ Bootstrap des rôles terminé (secrets non affichés).');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Pas de message SQL brut : une erreur de mot de passe peut contenir le SQL.
  const reason = ['DATABASE_ROLE_OWNS_OBJECTS', 'DATABASE_ROLE_MEMBERSHIP'].find(code => error.message?.startsWith(code));
  console.error(`Bootstrap refusé (${reason ?? error.code ?? 'connexion/configuration'}). Vérifier rôles, propriétaires et secrets dans le runbook Phase D.`);
  process.exitCode = 1;
} finally {
  await client.end();
}
