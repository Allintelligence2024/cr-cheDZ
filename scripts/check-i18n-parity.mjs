#!/usr/bin/env node
/**
 * check:i18n — garde de parité des traductions (E4/H3, remédiation 2026-10-15).
 *
 * Pourquoi ce gardien existe : l'audit a trouvé des chaînes **restées en français
 * dans le bloc arabe** (`bill.exportExcel`, `bill.exportRequested`) et un jeton
 * `{n}` affiché littéralement à l'écran (`children.imported`). Ces deux classes de
 * défaut sont silencieuses : l'application rend la valeur telle quelle, sans erreur,
 * et l'utilisateur arabophone voit du français (ou une accolade). Aucun test
 * applicatif ne les voyait passer.
 *
 * Vérifications (aucune dépendance, `node:fs` uniquement) :
 *   1. les jeux de clés `fr` et `ar` sont IDENTIQUES (une clé sans traduction échoue) ;
 *   2. une valeur `ar` identique à sa valeur `fr` est refusée, sauf acronyme/brand
 *      explicitement listé dans `IDENTICAL_ALLOWED` — le traducteur qui assume un
 *      « PDF » non traduit l'écrit ici, sinon c'est un oubli ;
 *   3. les jetons `{nom}` d'une chaîne `fr` existent aussi dans sa traduction `ar`
 *      (une interpolation perdue en traduction = accolade à l'écran) ;
 *   4. chaque `t('…')` appelé depuis `apps/admin-web` référence une clé qui EXISTE —
 *      une clé absente se rend elle-même à l'écran, ce qui est indétectable au
 *      runtime (repli volontaire de `i18n.tsx`).
 *
 * Usage : node scripts/check-i18n-parity.mjs [--verbose]
 * Sortie : 0 = conforme, 1 = dérive (liste explicite des clés concernées).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

const BUNDLE = join(repo, 'packages/i18n/src/index.ts');
const WEB_SRC = join(repo, 'apps/admin-web/src');

/** Valeurs volontairement identiques en fr et ar (acronymes, marques, formats). */
const IDENTICAL_ALLOWED = new Set([
  'bill.pdf', // « PDF » : nom de format, pas une chaîne à traduire
]);

const ENTRY = /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,?\s*$/;

/** Blocs `fr: { … }` et `ar: { … }` du paquet, appariés par profondeur d'accolades. */
function readLocaleBlocks(source) {
  const lines = source.split('\n');
  const blocks = {};
  let locale = null;
  let depth = 0;
  for (const line of lines) {
    if (!locale) {
      const open = /^\s{2}(fr|ar):\s*\{/.exec(line);
      if (open) {
        locale = open[1];
        depth = 1;
        blocks[locale] = new Map();
      }
      continue;
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    const entry = ENTRY.exec(line);
    if (entry && depth > 0) {
      blocks[locale].set(entry[1], entry[2] ?? entry[3] ?? '');
    }
    if (depth <= 0) locale = null;
  }
  return blocks;
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/** Tous les fichiers `.ts`/`.tsx` d'une arborescence (node_modules/dist exclus). */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) sources(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const problems = [];
const bundle = readFileSync(BUNDLE, 'utf8');
const blocks = readLocaleBlocks(bundle);
const fr = blocks.fr;
const ar = blocks.ar;
if (!fr || !ar || fr.size === 0 || ar.size === 0) {
  console.error('✗ check:i18n — blocs `fr`/`ar` introuvables dans packages/i18n/src/index.ts');
  process.exit(1);
}

// 1. parité des jeux de clés, dans les deux sens.
for (const key of fr.keys()) if (!ar.has(key)) problems.push(`clé "${key}" traduite absente du bloc ar`);
for (const key of ar.keys()) if (!fr.has(key)) problems.push(`clé "${key}" présente en ar mais pas en fr`);

let identical = 0;
let checked = 0;
for (const [key, frValue] of fr) {
  const arValue = ar.get(key);
  if (arValue === undefined) continue;
  checked += 1;
  // 2. valeur non traduite.
  if (arValue === frValue) {
    if (!IDENTICAL_ALLOWED.has(key)) problems.push(`clé "${key}" non traduite (ar identique à fr : « ${frValue} »)`);
    else identical += 1;
    continue;
  }
  // 3. jetons d'interpolation conservés à l'identique.
  const frTokens = placeholders(frValue).join(',');
  const arTokens = placeholders(arValue).join(',');
  if (frTokens !== arTokens) {
    problems.push(`clé "${key}" : jetons fr {${frTokens || '—'}} ≠ ar {${arTokens || '—'}}`);
  }
}

// 4. clés réellement appelées depuis l'administration existent dans le paquet.
let calls = 0;
for (const file of sources(WEB_SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\bt\(\s*'([A-Za-z0-9._-]+)'/g)) {
    calls += 1;
    if (!fr.has(match[1])) problems.push(`${relative(repo, file)} : t('${match[1]}') — clé absente du paquet i18n`);
  }
}

if (problems.length > 0) {
  console.error(`✗ check:i18n — ${problems.length} dérive(s) de traduction :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('  Correction : traduire dans packages/i18n/src/index.ts (les deux blocs), ou assumer le cas dans IDENTICAL_ALLOWED.');
  process.exit(1);
}

if (verbose) {
  for (const key of [...IDENTICAL_ALLOWED].sort()) console.log(`  • identique assumé : ${key}`);
}
console.log(`✓ check:i18n : ${fr.size} clés fr, ${ar.size} clés ar, jeux identiques ; ${checked} comparaisons, ${identical} identiques assumés ; ${calls} appels t() résolus.`);
