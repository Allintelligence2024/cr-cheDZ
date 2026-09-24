#!/usr/bin/env node
/**
 * Gardien « gardiens câblés » (audit 2026-09-24, §4.3 — classe « gardiens orphelins »).
 *
 * L'audit a trouvé **4 gardiens que rien n'appelait** : ils passaient au vert à la
 * main, jamais en CI — donc ils ne gardaient rien. Le lot 1 les a câblés ; ce script
 * empêche la classe entière de revenir : tout script dont le NOM suit la convention de
 * garde (`check-*`, `audit-*`, `verify-*`, `inventory-*`) doit être **atteignable**
 * depuis un workflow GitHub Actions.
 *
 * Comment « atteignable » est calculé (fermeture transitive, pas une devinette) :
 *   - racines   : `.github/workflows/*.yml` (ils déclenchent tout) ;
 *   - appelants : `package.json` (racine, apps, packages), tout fichier de `scripts/`
 *                 et `tests/`, les fichiers `.yml` sous `infrastructure/` — bref, tout
 *                 ce qui est capable d'invoquer un script ;
 *   - un fichier est atteignable s'il est nommé (nom de base) par un fichier atteignable.
 * Le nom de base suffit : c'est ainsi que ces scripts sont réellement appelés
 * (`node scripts/check-….mjs`), et cela évite de réimplémenter un parseur JS.
 *
 * Limite assumée : un script invoqué UNIQUEMENT par un fichier hors de ces catégories
 * (Dockerfile, fichier .md) est signalé comme orphelin — c'est voulu : une procédure
 * écrite dans un runbook n'exécute rien en CI.
 *
 * Usage : node scripts/check-guards-wired.mjs [--verbose]
 * Sortie : 0 = tous les gardiens sont câblés, 1 = au moins un orphelin (liste explicite).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

/** Convention de nommage des gardiens (documentée au plan de réparation, lot 1). */
const GUARD_NAME = /^(check|audit|verify|inventory)-[\w.-]+\.(mjs|sh)$/;

/** Fichiers capables d'invoquer un script — ce que la fermeture explore. */
const CALLER_DIRS = ['scripts', 'tests', 'infrastructure'];
const CALLER_FILES = ['package.json', join('packages', 'shared-config', 'package.json')];

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(join(repo, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

// ── Racines : les workflows ─────────────────────────────────────────────────
const workflowDir = join(repo, '.github', 'workflows');
const workflows = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
const rootText = workflows
  .map((f) => readFileSync(join(workflowDir, f), 'utf8'))
  .join('\n');

// ── Candidats (appelants potentiels) ────────────────────────────────────────
const candidates = new Set();
for (const f of CALLER_FILES) {
  try {
    statSync(join(repo, f));
    candidates.add(f);
  } catch {
    /* absent : ignoré */
  }
}
for (const dir of CALLER_DIRS) {
  for (const f of walk(dir)) {
    if (/\.(mjs|cjs|js|sh|ya?ml|json)$/.test(f)) candidates.add(f);
  }
}
for (const wf of workflows) candidates.add(join('.github', 'workflows', wf));
// package.json des workspaces (un script npm peut être le seul appelant)
for (const f of walk('apps')) if (basename(f) === 'package.json') candidates.add(f);

const texts = new Map();
for (const f of candidates) {
  try {
    texts.set(f, readFileSync(join(repo, f), 'utf8'));
  } catch {
    /* binaire/illisible : ignoré */
  }
}

// ── Fermeture transitive : qui est appelé, depuis la CI ─────────────────────
const mentions = (text, file) => new RegExp(`${basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
const reachable = new Set([...candidates].filter((f) => mentions(rootText, f)));
for (;;) {
  const next = [...candidates].filter(
    (f) => !reachable.has(f) && [...reachable].some((r) => mentions(texts.get(r) ?? '', f)),
  );
  if (next.length === 0) break;
  for (const f of next) reachable.add(f);
}

// ── Gardiens : tous doivent être atteignables ───────────────────────────────
const guards = [];
for (const f of candidates) {
  if (f.startsWith('scripts') && GUARD_NAME.test(basename(f))) guards.push(f);
}
guards.sort();

const orphans = guards.filter((g) => !reachable.has(g));

if (verbose || orphans.length > 0) {
  console.log(`Gardiens recensés (convention ${GUARD_NAME}) : ${guards.length}`);
  for (const g of guards) {
    console.log(`  ${reachable.has(g) ? '✓ câblé     ' : '✗ ORPHELIN  '} ${g}`);
  }
}

if (orphans.length > 0) {
  console.error(`\n✗ ${orphans.length} gardien(s) que rien n'appelle en CI :`);
  for (const o of orphans) console.error(`  - ${o}`);
  console.error(
    '\nUn gardien que rien n\'exécute ne garde rien : soit l\'appeler depuis un workflow\n' +
      '(job `quality`), soit retirer la convention de nommage / supprimer le script.',
  );
  process.exit(1);
}

console.log(`✓ ${guards.length} gardiens recensés, tous atteignables depuis un workflow GitHub Actions.`);
