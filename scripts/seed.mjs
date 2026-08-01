#!/usr/bin/env node
/**
 * Runner de seeds (données de référence, idempotentes — INSERT ON CONFLICT).
 * Les seeds ne contiennent AUCUNE donnée d'organisation (créées via l'API).
 *
 * Usage : node scripts/seed.mjs
 * Env   : DATABASE_URL
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'infrastructure', 'database', 'seeds');

async function run() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const files = readdirSync(SEEDS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const content = readFileSync(join(SEEDS_DIR, file), 'utf8');
      console.log(`→ Seed ${file}`);
      await client.query(content);
    }
    console.log('✓ Seeds appliqués.');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error('✗ Échec des seeds:', error.message);
  process.exit(1);
});
