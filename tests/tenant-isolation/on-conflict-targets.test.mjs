/**
 * Garde : chaque `ON CONFLICT (...)` du code doit correspondre à une
 * contrainte réellement présente dans les migrations.
 *
 * Pourquoi ce test existe
 * -----------------------
 * PostgreSQL exige qu'une clause `ON CONFLICT (colonnes)` corresponde
 * EXACTEMENT à une contrainte unique ou une clé primaire. Si la contrainte
 * disparaît — typiquement parce qu'une migration l'a remplacée — la requête
 * entière est rejetée à l'exécution. Rien ne le signale à la compilation :
 * ni TypeScript, ni ESLint, ni les tests unitaires ne lisent le SQL.
 *
 * Cas réel : la migration 073 (R19) a remplacé
 *   UNIQUE (user_id, channel, event_type)
 * par
 *   UNIQUE (organization_id, user_id, channel, event_type)
 * sur `notification_preferences`, pour qu'un utilisateur multi-crèche puisse
 * gérer ses préférences indépendamment par tenant. Le `ON CONFLICT` de
 * `ParentsService.savePreference()` n'a pas suivi : l'enregistrement d'une
 * préférence échouait donc systématiquement. Le symptôme était indirect et
 * très coûteux à diagnostiquer — un parent qui désactivait ses notifications
 * continuait de recevoir des push, parce que la préférence n'était jamais
 * écrite.
 *
 * Ce contrôle est statique : ni PostgreSQL ni exécution requise, donc il
 * tourne partout et attrape la régression avant la CI.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'infrastructure', 'database', 'migrations');

/** Normalise une liste de colonnes : ordre conservé, espaces supprimés. */
const normalize = (columns) =>
  columns
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .join(',');

/** Ensemble des colonnes, pour comparer sans tenir compte de l'ordre —
 *  PostgreSQL, lui, accepte n'importe quel ordre. */
const asSet = (columns) => normalize(columns).split(',').sort().join(',');

/**
 * Rejoue les migrations DANS L'ORDRE et tient compte des suppressions.
 *
 * Une simple union de tous les fichiers donnerait un faux négatif : la
 * contrainte supprimée par une migration ultérieure resterait « visible »
 * dans le fichier qui l'a créée. C'est précisément le cas qui a laissé
 * passer le bug de `notification_preferences` (créée en 009, supprimée
 * en 073).
 */
function collectSchemaConstraints() {
  /** @type {Map<string, string>} colonnes normalisées -> nom de contrainte */
  const byColumns = new Map();
  /** @type {Map<string, string>} nom de contrainte -> colonnes normalisées */
  const byName = new Map();
  const add = (columns, name) => {
    const key = asSet(columns);
    byColumns.set(key, name ?? key);
    if (name) byName.set(name.toLowerCase(), key);
  };

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001, 002, … : l'ordre lexical est l'ordre d'application

  for (const file of files) {
    // Les commentaires SQL citent souvent l'ancienne contrainte (« Avant :
    // UNIQUE(...) »). Les conserver ferait croire qu'elle existe encore.
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');

    /*
      Contrainte anonyme dans un CREATE TABLE : PostgreSQL la nomme
      automatiquement `<table>_<colonnes>_key`. C'est ce nom généré que visent
      les `DROP CONSTRAINT` ultérieurs — il faut donc le reconstituer, sans
      quoi la suppression ne peut pas être reliée à sa création.
    */
    for (const table of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, tableName, body] = table;
      for (const m of body.matchAll(/(?:^|,)\s*UNIQUE\s*\(([^)]+)\)/gi)) {
        const columns = normalize(m[1]).split(',');
        add(m[1], `${tableName}_${columns.join('_')}_key`);
      }
    }

    // ADD CONSTRAINT nom UNIQUE (a, b) — on retient le nom pour les DROP.
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+([a-z0-9_]+)\s+(?:UNIQUE|PRIMARY\s+KEY)\s*\(([^)]+)\)/gi)) {
      add(m[2], m[1]);
    }
    // CONSTRAINT nom UNIQUE (a, b) en création de table.
    for (const m of sql.matchAll(/CONSTRAINT\s+([a-z0-9_]+)\s+(?:UNIQUE|PRIMARY\s+KEY)\s*\(([^)]+)\)/gi)) {
      add(m[2], m[1]);
    }
    // UNIQUE (a, b) / PRIMARY KEY (a, b) anonymes.
    for (const m of sql.matchAll(/(?<!CONSTRAINT\s\w{0,64}\s)(?:UNIQUE|PRIMARY\s+KEY)\s*\(([^)]+)\)/gi)) {
      if (!byColumns.has(asSet(m[1]))) add(m[1], null);
    }
    for (const m of sql.matchAll(/CREATE\s+UNIQUE\s+INDEX[^(]*\(([^)]+)\)/gi)) {
      add(m[1], null);
    }
    // Colonne déclarée inline : `id UUID PRIMARY KEY`, `slug TEXT UNIQUE`.
    for (const m of sql.matchAll(/^\s*([a-z_]+)\s+[A-Za-z0-9_ ()]*?(?:PRIMARY\s+KEY|UNIQUE)\b/gim)) {
      add(m[1], null);
    }

    // Suppressions : la contrainte cesse d'exister à partir d'ici.
    for (const m of sql.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z0-9_]+)/gi)) {
      const name = m[1].toLowerCase();
      const columns = byName.get(name);
      if (columns) {
        byColumns.delete(columns);
        byName.delete(name);
      }
    }
    for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([a-z0-9_.]+)/gi)) {
      const columns = byName.get(m[1].toLowerCase());
      if (columns) byColumns.delete(columns);
    }
  }
  return new Set(byColumns.keys());
}

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('chaque ON CONFLICT vise une contrainte existante', () => {
  const constraints = collectSchemaConstraints();
  assert.ok(constraints.size > 20, `trop peu de contraintes extraites (${constraints.size})`);

  const sources = [
    ...collectSourceFiles(join(repoRoot, 'apps', 'api', 'src')),
    ...collectSourceFiles(join(repoRoot, 'apps', 'worker', 'src')),
  ];

  const orphans = [];
  for (const file of sources) {
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/ON CONFLICT\s*\(([^)]+)\)/gi)) {
      const target = match[1];
      // `ON CONFLICT ON CONSTRAINT nom` et `DO NOTHING` sans colonnes sont hors périmètre.
      if (/constraint/i.test(target)) continue;
      if (!constraints.has(asSet(target))) {
        orphans.push(`${file.replace(repoRoot + '/', '')} : ON CONFLICT (${target.trim()})`);
      }
    }
  }

  assert.deepEqual(
    orphans,
    [],
    'ON CONFLICT sans contrainte correspondante — PostgreSQL rejettera la requête :\n  ' +
      orphans.join('\n  '),
  );
});
