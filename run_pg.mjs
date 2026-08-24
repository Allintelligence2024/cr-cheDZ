/**
 * PostgreSQL 18 embarqué pour la validation locale (tests d'isolation).
 *
 * - Données : /tmp/pgtest/data (purgeables — recréées par initialise()).
 * - Port 54329, superuser postgres/postgres, base creche_test.
 * - Le rôle applicatif creche_app_test (NOBYPASSRLS) est créé par les
 *   helpers de test (tests/tenant-isolation/helpers.mjs ensureAppRole).
 *
 * Usage : node run_pg.mjs   (process keep-alive : le serveur tourne tant
 * que le process vit ; l'arrêter avec SIGINT/SIGTERM ou stop_process).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = '/tmp/pgtest/data';
const DATABASE = 'creche_test';
const USER = 'postgres';
const PASSWORD = 'postgres';
const PORT = 54329;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
});

if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
  console.log(`[run_pg] initialise() — ${DATA_DIR} vide`);
  await pg.initialise();
  console.log('[run_pg] initialisé');
}

await pg.start();
console.log(`[run_pg] démarré sur le port ${PORT}`);
await pg.createDatabase(DATABASE).catch((error) => {
  // 42P04 duplicate_database — déjà créée lors d'un run précédent.
  if (!/already exists|42P04/i.test(String(error?.message ?? error))) throw error;
  console.log(`[run_pg] base ${DATABASE} déjà présente`);
});
console.log(`[run_pg] prêt : postgres://postgres:postgres@localhost:${PORT}/${DATABASE}`);

const shutdown = async (signal) => {
  console.log(`[run_pg] ${signal} — arrêt propre`);
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Keep-alive : le process reste vivant jusqu'au signal.
setInterval(() => {}, 1 << 30);
