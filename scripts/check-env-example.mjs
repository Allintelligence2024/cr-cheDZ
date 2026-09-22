#!/usr/bin/env node
/**
 * check:env-example — garde anti-dérive des fichiers d'exemple d'environnement.
 *
 * Les boot guards (packages/prod-config) REFUSENT le démarrage production si
 * une variable requise est absente. Un .env.prod.example incomplet conduit
 * donc à un refus de boot garanti depuis l'exemple (F9 : TOTP_ENCRYPTION_KEY
 * manquait — l'API exige la clé en production, l'exemple ne la listait pas).
 *
 * Ce script vérifie que chaque variable requise figure en ligne NON commentée
 * (VAR=...) dans les fichiers .example. Aucune dépendance (node:fs uniquement).
 *
 * Usage : node scripts/check-env-example.mjs   (exit 1 si un exemple est incomplet)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Variables sans lesquelles le boot PRODUCTION est refusé :
 *  - boot guards packages/prod-config/src/index.ts (assertProductionConfig) :
 *    NODE_ENV, DATABASE_URL, JWT_SECRET, PAYMENT_WEBHOOK_SECRET,
 *    STORAGE_BACKEND, TOTP_ENCRYPTION_KEY ;
 *  - compose prod (variables ${VAR:?} — docker compose refuse de démarrer) :
 *    POSTGRES_DB, POSTGRES_PASSWORD, APP_DATABASE_PASSWORD,
 *    MIGRATOR_DATABASE_PASSWORD, MIGRATION_DATABASE_URL, VERSION,
 *    BACKUP_PASSPHRASE, ALERT_WEBHOOK_TOKEN_FILE.
 */
const REQUIRED_PROD = [
  'NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'PAYMENT_WEBHOOK_SECRET',
  'STORAGE_BACKEND', 'TOTP_ENCRYPTION_KEY',
  'POSTGRES_DB', 'POSTGRES_PASSWORD', 'APP_DATABASE_PASSWORD',
  'MIGRATOR_DATABASE_PASSWORD', 'MIGRATION_DATABASE_URL', 'VERSION',
  'BACKUP_PASSPHRASE', 'ALERT_WEBHOOK_TOKEN_FILE',
];

/** Requises aussi côté dev (boot API/worker hors production) pour .env.example. */
const REQUIRED_DEV = [
  'DATABASE_URL', 'JWT_SECRET', 'PAYMENT_WEBHOOK_SECRET',
  'STORAGE_BACKEND', 'TOTP_ENCRYPTION_KEY',
];

function declaredVars(file) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const vars = new Set();
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (m) vars.add(m[1]);
  }
  return vars;
}

let failed = false;
for (const [file, required] of [
  ['.env.prod.example', REQUIRED_PROD],
  ['.env.example', REQUIRED_DEV],
]) {
  const vars = declaredVars(file);
  const missing = required.filter((name) => !vars.has(name));
  if (missing.length === 0) {
    console.log(`✓ ${file} : ${required.length} variables requises présentes`);
  } else {
    failed = true;
    console.error(`✗ ${file} : variable(s) requise(s) absente(s) : ${missing.join(', ')}`);
  }
}
if (failed) {
  console.error('\nCorrigez les fichiers .example puis relancez : node scripts/check-env-example.mjs');
}
process.exit(failed ? 1 : 0);
