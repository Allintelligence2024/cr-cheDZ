#!/usr/bin/env node
/**
 * Sanity check des scripts de load testing (Phase 4 / S4 — remédiation 2026-09-21).
 *
 * Le plan S4 demande de « documenter les cibles de capacité » et de rejouer
 * `sync.k6.js` sur la cible VPS réelle. La cible VPS n'est PAS accessible
 * depuis cette sandbox — ce script vérifie ce qui peut l'être :
 *
 *   1. tests/load/sync.k6.js : parse AST, options k6 présentes (vus,
 *      iterations, thresholds), blocs setup + default exportés, scénarios
 *      HTTP listés (login, sync/push, feed).
 *   2. tests/load/capacity-bench.mjs : syntaxe Node valide, variables
 *      d'env documentées (ORGS, CHILDREN, DEVICES, OPS, BURST_ROUNDS),
 *      budgets p95 présents (cliquet anti-régression).
 *   3. Cohérence : les seuils k6 (p95 < 2000 ms sync push) et les budgets
 *      capacity-bench (p95 < 3000 ms) sont alignés (k6 plus strict : OK,
 *      un delta de 50 % est attendu car k6 = saturation, bench = charge
 *      normale).
 *
 * Usage : node scripts/verify-load-tests.mjs
 * Sortie : exit 0 si tout est OK, exit 1 sinon. JSON final pour CI.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const ok = (label, pass, detail) => checks.push({ label, pass, detail });

// ── 1. sync.k6.js ────────────────────────────────────────────────────────
const k6 = readFileSync(join(repo, 'tests/load/sync.k6.js'), 'utf8');
ok('k6 : présent', k6.length > 0, `${k6.length} octets`);

const hasOptions = /export const options\s*=\s*\{/.test(k6);
ok('k6 : export const options présent', hasOptions);

const hasVus = /vus:\s*\d+/.test(k6);
const hasIterations = /iterations:\s*\d+/.test(k6);
ok('k6 : vus + iterations déclarés', hasVus && hasIterations);

const hasThresholds = /thresholds:\s*\{[\s\S]*?http_req_duration[\s\S]*?p\(95\)/.test(k6);
ok('k6 : threshold p95 présent', hasThresholds);

const hasHttpReqFailed = /http_req_failed/.test(k6);
ok('k6 : threshold http_req_failed présent', hasHttpReqFailed);

const hasSetup = /export function setup/.test(k6);
const hasDefault = /export default function/.test(k6);
ok('k6 : setup() + default exportés', hasSetup && hasDefault);

const hasLogin = /\/auth\/login/.test(k6);
const hasSyncPush = /\/sync\/push/.test(k6);
const hasFeed = /\/parent\/children/.test(k6);
ok('k6 : endpoints login + sync/push + feed appelés',
   hasLogin && hasSyncPush && hasFeed,
   `login=${hasLogin} push=${hasSyncPush} feed=${hasFeed}`);

// ── 2. capacity-bench.mjs ───────────────────────────────────────────────
const bench = readFileSync(join(repo, 'tests/load/capacity-bench.mjs'), 'utf8');
ok('bench : présent', bench.length > 0, `${bench.length} octets`);

// Syntaxe Node valide (acorn parse le module — on ne fait pas de `require`,
// juste vérifier que le code parse sans erreur).
let benchSyntaxOk = true;
try {
  const { parse } = await import('acorn');
  parse(bench, { sourceType: 'module', ecmaVersion: 2023, allowImportExportEverywhere: true });
} catch (e) {
  benchSyntaxOk = false;
  ok('bench : syntaxe valide', false, e.message);
}
if (benchSyntaxOk) ok('bench : syntaxe valide', true);

const envs = ['ORGS', 'CHILDREN', 'DEVICES', 'OPS', 'BURST_ROUNDS'];
// Le bench utilise `env('ORGS', 12)` ou `process.env['ORGS']` — on accepte les
// deux notations (simple + double quote).
const hasAllEnvs = envs.every((e) => {
  const sq = `env('${e}'`; // simple quote
  const dq = `env("${e}"`; // double quote
  const directSq = `process.env['${e}']`;
  const directDq = `process.env["${e}"]`;
  return bench.includes(sq) || bench.includes(dq) || bench.includes(directSq) || bench.includes(directDq);
});
ok(`bench : envs ${envs.join(', ')} documentées`, hasAllEnvs);

const hasBudgets = /BUDGET_P95\s*=/.test(bench) &&
  /login:\s*\d/.test(bench) &&
  /sync_push:\s*\d/.test(bench);
ok('bench : BUDGET_P95 avec login + sync_push', hasBudgets);

// Cliquet anti-régression — au moins 5 scénarios mesurés.
const measured = ['login', 'checkin', 'sync_push', 'feed', 'dashboard'];
const hasAllMeasured = measured.every((m) => new RegExp(`api\\(['"]${m}['"]`).test(bench));
ok(`bench : ${measured.length} scénarios mesurés (${measured.join(', ')})`, hasAllMeasured);

// ── 3. Cohérence k6 ↔ bench ──────────────────────────────────────────────
const benchBudget = bench.match(/sync_push:\s*(\d+)/)?.[1];
const k6Threshold = k6.match(/p\(95\)<(\d+)/)?.[1];
const benchInt = benchBudget ? parseInt(benchBudget, 10) : null;
const k6Int = k6Threshold ? parseInt(k6Threshold, 10) : null;
if (benchInt && k6Int) {
  // k6 doit être plus strict (saturation 50 VUs) que bench (charge normale
  // ~2 VUs). Ratio attendu : 0.5 ≤ k6/bench ≤ 1.0. En dehors : warning.
  const ratio = k6Int / benchInt;
  ok('k6 ↔ bench : seuil k6 ≤ bench (saturation plus stricte)',
     ratio <= 1.0 && ratio >= 0.5,
     `k6=${k6Int}ms bench=${benchInt}ms ratio=${ratio.toFixed(2)}`);
} else {
  ok('k6 ↔ bench : seuils comparables', false, 'seuils introuvables');
}

// ── 4. Documentation ────────────────────────────────────────────────────
const loadDoc = readFileSync(join(repo, 'tests/load/capacity-bench.mjs'), 'utf8');
const hasBudgetComment = /Budgets.*cliquet/.test(loadDoc);
ok('bench : commentaire « cliquet anti-régression » présent', hasBudgetComment);

// ── 5. k6 : discours « tests de charge » honnête (2026-09-25) ────────────
//
// Le plan de réparation laissait deux issues : exécuter `sync.k6.js` sur une
// cible prod-like et publier les résultats, **ou** le retirer du discours
// « tests de charge ». Ici, k6 n'est pas installable (binaire absent,
// distributions injoignables) : l'issue retenue est de (a) mesurer le critère
// avec le banc exécutable, (b) dire explicitement que le script k6, lui, n'est
// pas exécuté. Ces contrôles empêchent la doc de se « regonfler » ensuite.
const k6Header = k6.slice(0, Math.max(0, k6.indexOf('import http')));
ok('k6 : en-tête déclarant « NON EXÉCUTÉ » (statut honnête)',
   /NON EXÉCUTÉ/.test(k6Header),
   k6Header.length ? 'en-tête analysé' : 'en-tête introuvable');

// Promesse produit à ne pas relâcher : p95 < 2 s (issue du plan Phase 11).
ok('k6 : seuil p95 ≤ 2000 ms (promesse non relâchée)',
   Number.isFinite(k6Int) && k6Int <= 2000,
   `p95<${k6Int}ms`);

// La parité k6 → banc doit être documentée avec la commande rejouable.
const repPlan = readFileSync(join(repo, 'docs/PLAN_REPARATION_2026-09-24.md'), 'utf8');
const parityCmd = /ORGS=10\s+DEVICES=5\s+OPS=10\s+BURST_ROUNDS=0/.test(repPlan);
ok('docs : commande de parité k6 (50 pushes × 10 ops = 500 ops) documentée',
   parityCmd,
   parityCmd ? 'PLAN_REPARATION §5' : 'commande absente — preuve non rejouable');

// Aucun document « vivant » ne doit présenter k6 comme exécuté. Les rapports
// historiques (PHASE4-MANUAL, PLAN_EXECUTION_*, PLAN_IMPL…) ne sont pas
// scannés : ils datent leurs propres constats. La liste ci-dessous est celle
// des documents qui décrivent l'état COURANT.
const LIVE_DOCS = ['README.md', 'docs/HANDOFF.md', 'docs/ROADMAP_V2.md',
  'docs/ANALYSE_PILIERS_MANQUANTS.md', 'docs/PLAN_REPARATION_2026-09-24.md'];
const HONEST = /non exécut|jamais exécut|pas été exécut|binaire absent|sans k6|capacity-bench|test:capacity|parité|BLOQUÉE|k6 absent|injoignable|impossible/i;
// Contrôle au paragraphe (et non à la ligne) : un constat d'honnêteté peut
// légitimement tenir sur la phrase suivante dans de la prose markdown.
const offenders = [];
for (const rel of LIVE_DOCS) {
  const blocks = readFileSync(join(repo, rel), 'utf8').split(/\n[ \t]*\n/);
  let line = 1;
  for (const block of blocks) {
    const isHeading = block.split('\n').every((l) => /^#{1,6} /.test(l.trim()) || l.trim() === '');
    if (!isHeading && /\bk6\b/.test(block) && !HONEST.test(block)) offenders.push(`${rel}:${line}`);
    line += block.split('\n').length + 1;
  }
}
ok('docs vivants : chaque mention de k6 dit qu\'il n\'est pas exécuté (ou renvoie au banc)',
   offenders.length === 0,
   offenders.length ? offenders.join(', ') : `${LIVE_DOCS.length} documents contrôlés`);

// ── Rapport ─────────────────────────────────────────────────────────────
const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);

console.log('──────────────────────────────────────────');
console.log('LOAD TESTS SANITY CHECK (S4, Phase 4)');
console.log('──────────────────────────────────────────');
for (const c of checks) {
  console.log(`  ${c.pass ? '✓' : '✗'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log('──────────────────────────────────────────');
console.log(`${passed} / ${checks.length} checks OK`);

console.log('\n---JSON---');
console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  passed, failed: failed.length,
  checks,
}, null, 2));

if (failed.length > 0) {
  console.log(`\n✗ ${failed.length} check(s) échoué(s)`);
  process.exit(1);
}
console.log('\n✓ Sanity checks load tests : OK.');
console.log('  Note : ce script valide la STRUCTURE des tests de charge.');
console.log('  Pour exécuter les tests réels :');
console.log('    - capacity-bench.mjs : DATABASE_URL=postgres://… node tests/load/capacity-bench.mjs');
console.log('      (parité k6 — 500 ops en 50 pushes × 10 : ORGS=10 DEVICES=5 OPS=10 BURST_ROUNDS=0)');
console.log('    - sync.k6.js : NON EXÉCUTÉ ici (binaire k6 absent) — k6 run tests/load/sync.k6.js');
console.log('      depuis un poste ou une cible VPS qui dispose de k6');
process.exit(0);
