#!/usr/bin/env node
/**
 * Runner de migrations (C05).
 * - Applique les fichiers SQL de infrastructure/database/migrations/ dans l'ordre.
 * - Enregistre le checksum SHA-256 de chaque fichier dans schema_migrations.
 * - Refuse de rejouer un fichier dont le checksum a changé (ADR-007 :
 *   une migration appliquée ne se modifie jamais).
 *
 * Usage :
 *   node scripts/migrate.mjs               # applique les migrations en attente
 *   node scripts/migrate.mjs --status      # état des migrations
 *   node scripts/migrate.mjs --check       # vérifie que dev == cible (drift detection)
 *   node scripts/migrate.mjs --reset       # DESTRUCTIF : drop schema public (dev uniquement)
 *
 * Env : DATABASE_URL (ou PG* classiques)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'infrastructure', 'database', 'migrations');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      return { file, checksum: sha256(content), content };
    });
}

async function connect() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function status(client) {
  await ensureTable(client);
  const applied = new Map(
    (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]),
  );
  const files = listMigrations();
  console.log('┌──────────────────────────────────────────┬──────────┬──────────┐');
  console.log('│ Fichier                                  │ État     │ Checksum │');
  console.log('├──────────────────────────────────────────┼──────────┼──────────┤');
  let drift = false;
  for (const { file, checksum } of files) {
    const remote = applied.get(file);
    const state = remote === undefined ? 'EN ATTENTE' : remote === checksum ? 'appliquée' : 'DRIFT !';
    if (state === 'DRIFT !') drift = true;
    console.log(`│ ${file.padEnd(41)} │ ${state.padEnd(8)} │ ${checksum.slice(0, 8)}${remote ? '' : '        '} │`);
  }
  console.log('└──────────────────────────────────────────┴──────────┴──────────┘');
  if (drift) {
    console.error('✗ DRIFT DÉTECTÉ : une migration appliquée a été modifiée (interdit, ADR-007).');
    process.exitCode = 2;
  } else {
    console.log('✓ Schéma cohérent avec les fichiers de migrations.');
  }
}

async function migrate(client) {
  await ensureTable(client);
  const applied = new Map(
    (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]),
  );
  let appliedCount = 0;
  for (const { file, checksum, content } of listMigrations()) {
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        throw new Error(
          `Migration ${file} déjà appliquée avec un checksum différent. ` +
            'Une migration appliquée ne se modifie jamais (ADR-007). Créez une nouvelle migration.',
        );
      }
      continue;
    }
    console.log(`→ Application de ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(content);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Échec de la migration ${file}: ${error.message}`);
    }
  }
  console.log(appliedCount === 0 ? '✓ Aucune migration en attente.' : `✓ ${appliedCount} migration(s) appliquée(s).`);
}

async function reset(client) {
  console.warn('⚠  DESTRUCTIF : suppression du schéma public (dev uniquement).');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  console.log('✓ Schéma public réinitialisé.');
}

const [,, flag] = process.argv;
const client = await connect();
try {
  if (flag === '--status' || flag === '--check') {
    await status(client);
  } else if (flag === '--reset') {
    await reset(client);
    await migrate(client);
  } else {
    await migrate(client);
  }
} finally {
  await client.end();
}
