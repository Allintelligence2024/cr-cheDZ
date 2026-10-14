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
 *
 * Encodage : UTF8 imposé à initdb (défaut Windows = WIN1252, qui fait
 * échouer les migrations contenant des caractères non ASCII — flèches,
 * accents composés). Un cluster existant dans un autre encodage est refusé
 * avec un message explicite (il faut purger /tmp/pgtest/data).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client as PgClient } from 'pg';

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
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
  console.log(`[run_pg] initialise() — ${DATA_DIR} vide`);
  await pg.initialise();
  console.log('[run_pg] initialisé');
}

await pg.start();
console.log(`[run_pg] démarré sur le port ${PORT}`);

// Garde d'encodage : un cluster initialisé autrement (ex. WIN1252 par défaut
// de Windows) casse les migrations SQL non ASCII — échec explicite, pas un
// 22P05/erreur de conversion au milieu de la batterie.
const url = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;
const probe = new PgClient({ connectionString: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres` });
await probe.connect();
const { rows: [enc] } = await probe.query('SHOW server_encoding');
await probe.end();
if (enc.server_encoding !== 'UTF8') {
  console.error(`✗ Cluster existant en ${enc.server_encoding} (${DATA_DIR}) — UTF8 requis.`);
  console.error('  Purgez le répertoire de données puis relancez : rm -rf /tmp/pgtest/data');
  await pg.stop().catch(() => {});
  process.exit(3);
}
console.log(`[run_pg] encodage serveur : ${enc.server_encoding}`);

await pg.createDatabase(DATABASE).catch((error) => {
  // 42P04 duplicate_database — déjà créée lors d'un run précédent.
  if (!/already exists|42P04/i.test(String(error?.message ?? error))) throw error;
  console.log(`[run_pg] base ${DATABASE} déjà présente`);
});
console.log(`[run_pg] prêt : ${url}`);

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
