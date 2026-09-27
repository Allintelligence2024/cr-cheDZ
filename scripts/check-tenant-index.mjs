#!/usr/bin/env node
/**
 * GARDIEN — index de tête `organization_id` sur les tables tenant
 * (remédiation 2026-09-27, lot 1 ; défaut D1 du plan).
 *
 * Pourquoi ce gardien existe
 * --------------------------
 * Chaque politique RLS s'écrit `USING (organization_id = app_tenant_id())`.
 * Ce prédicat est ajouté à toute requête, même quand le développeur ne
 * l'écrit pas. Sans index dont `organization_id` est la PREMIÈRE colonne,
 * PostgreSQL balaie la table entière — toutes organisations confondues — pour
 * rendre les lignes d'un seul tenant : **le coût de service d'une crèche
 * croît linéairement avec le nombre de crèches hébergées**. Mesuré à 5,8×
 * (40 organisations) et 16,1× (100 organisations) par
 * `tests/perf/bench-tenant-index.mjs`.
 *
 * Le défaut est invisible en développement (une seule organisation, quelques
 * lignes : le balayage est plus rapide qu'un index) et en CI (base fraîche).
 * Rien, avant ce gardien, ne pouvait le signaler : c'est exactement la classe
 * de panne qui ne se voit qu'en production, avec des clients dedans.
 *
 * Ce qu'il contrôle
 * -----------------
 *   1. Toute table avec la RLS activée ET une colonne `organization_id` doit
 *      posséder un index VALIDE dont `organization_id` est la tête.
 *   2. Les exemptions sont EXPLICITES et JUSTIFIÉES ici ; une exemption qui
 *      nomme une table inexistante est une erreur (liste périmée).
 *   3. Une table exemptée qui porte finalement un index est signalée
 *      (information, pas échec) : l'exemption peut alors être retirée.
 *
 * Modes
 * -----
 *   - DATABASE_URL défini  : vérification contre le catalogue réel. C'est le
 *     seul mode qui protège ; c'est celui utilisé par la CI (job `database`,
 *     PostgreSQL 18).
 *   - DATABASE_URL absent  : **échec (code 2)**. Contrairement à
 *     `check-rls-usage.mjs`, qui peut retomber sur des listes figées, ce
 *     gardien n'a AUCUNE source de rechange : sans catalogue, il ne peut rien
 *     affirmer. Il refuse donc de rendre un vert (règle du dépôt : « pas de
 *     faux vert ») au lieu de laisser croire qu'il a vérifié.
 *
 * Usage : node scripts/check-tenant-index.mjs [--verbose]
 *   DATABASE_URL=... node scripts/check-tenant-index.mjs
 */
import pg from 'pg';

const verbose = process.argv.includes('--verbose');

/**
 * Exemptions — chacune doit porter sa justification.
 *
 * Une exemption n'est acceptée que pour l'une de ces deux raisons :
 *   • la table est SYSTÈME (pas de RLS par conception) ;
 *   • la table est de CONFIGURATION : quelques dizaines de lignes au maximum,
 *     le balayage y est optimal.
 * Toute autre exemption est un défaut déguisé.
 */
const EXEMPTIONS = new Map([
  ['users', 'table système — sans RLS par conception (accès cross-tenant contrôlé par les gardes applicatifs) ; déjà indexée sur email/phone'],
  ['sessions', 'table système — sans RLS par conception ; déjà indexée sur user_id et refresh_token_hash'],
  ['feature_flags', 'configuration — quelques dizaines de lignes au maximum ; possède UNIQUE(flag_key, organization_id) qui sert la recherche courante'],
  ['processing_registry', 'configuration — modèles globaux + entrées par organisation, quelques dizaines de lignes ; le balayage y est optimal'],
]);

const failures = [];
const warnings = [];

/** Absence de base : ce gardien ne peut rien affirmer — il ne rend pas de vert. */
const EXIT_NO_CATALOGUE = 2;

function fail(message) {
  failures.push(message);
  console.error(`  ✗ ${message}`);
}
function pass(message) {
  if (verbose) console.log(`  ✓ ${message}`);
}
function warn(message) {
  warnings.push(message);
  console.warn(`  ! ${message}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Pas de repli possible : sans catalogue, aucune affirmation n'est
    // défendable. On échoue (code distinct) plutôt que de rendre un vert vide.
    console.error(
      '✗ DATABASE_URL absent — impossible de vérifier l’indexation tenant.\n' +
        '  Ce gardien lit pg_class/pg_index : il n’a aucune source de rechange.\n' +
        '  Le brancher dans un job qui fournit PostgreSQL (job `database` de la CI).\n' +
        '  exemptions déclarées : ' + [...EXEMPTIONS.keys()].join(', '),
    );
    process.exit(EXIT_NO_CATALOGUE);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    console.log('1) Index de tête organization_id sur les tables tenant');

    // 1. Tables tenant (RLS active) avec organization_id, sans index de tête.
    const missing = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid
            AND i.indisvalid
            AND i.indkey[0] = (
              SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'organization_id'
            )
        )
      ORDER BY 1
    `);

    const unjustified = missing.rows.filter((r) => !EXEMPTIONS.has(r.table_name));
    for (const r of unjustified) {
      fail(
        `table tenant sans index de tête organization_id : ${r.table_name} ` +
          `(ajouter l'index ou une exemption justifiée dans ce gardien)`,
      );
    }
    if (unjustified.length === 0) {
      pass(`aucune table tenant sans index organization_id (hors ${EXEMPTIONS.size} exemptions justifiées)`);
    }

    // 2. Exemptions périmées : une exemption doit nommer une table existante.
    const existing = new Set(
      (
        await client.query(`
          SELECT c.relname AS table_name
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
        `)
      ).rows.map((r) => r.table_name),
    );
    for (const name of EXEMPTIONS.keys()) {
      if (!existing.has(name)) {
        fail(`exemption « ${name} » : table inexistante — la liste d'exemptions est périmée`);
      }
    }
    pass(`les ${EXEMPTIONS.size} exemptions nomment des tables existantes`);

    // 3. Une exemption qui n'a plus lieu d'être (la table est indexée quand
    //    même) est signalée sans faire échouer : c'est un nettoyage possible.
    const exemptIndexed = await client.query(
      `
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
        AND EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid AND i.indisvalid
            AND i.indkey[0] = (
              SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'organization_id')
        )
      ORDER BY 1
    `,
      [[...EXEMPTIONS.keys()]],
    );
    for (const r of exemptIndexed.rows) {
      warn(`exemption « ${r.table_name} » : la table porte un index organization_id — l'exemption est peut-être à retirer`);
    }

    console.log('2) Validité des index tenant');
    // Un index INVALID (échec de CREATE INDEX CONCURRENTLY) ne sert à rien et
    // dégrade les écritures : c'est le piège classique de la voie CONCURRENTLY
    // documentée dans la migration 077.
    const invalid = await client.query(`
      SELECT c.relname AS table_name, i.indexrelid::regclass::text AS index_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT i.indisvalid
        AND i.indkey[0] = (
          SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'organization_id')
    `);
    for (const r of invalid.rows) {
      fail(`index organization_id INVALID sur ${r.table_name} (${r.index_name}) — un CREATE INDEX CONCURRENTLY a échoué ; le reconstruire`);
    }
    if (invalid.rows.length === 0) pass('aucun index organization_id invalide');
  } finally {
    await client.end();
  }
}

await main();

if (warnings.length > 0) console.log(`\n${warnings.length} avertissement(s).`);
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} contrôle(s) en échec — indexation tenant incomplète.`);
  process.exit(1);
}
console.log('\n✓ Indexation organization_id des tables tenant : conforme.');
