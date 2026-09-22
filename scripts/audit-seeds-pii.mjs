#!/usr/bin/env node
/**
 * Audit PII des seeds (Phase 4 / S6 — remédiation 2026-09-21).
 *
 * Vérifie que scripts/pilot/seed-pilot.mjs + infrastructure/database/seeds/*.sql
 * ne contiennent QUE des données synthétiques (téléphones DZ, emails, NIN).
 *
 * Le plan exige la PREUVE que les seeds sont 100% synthétiques — pas
 * suffisant de le déclarer dans l'en-tête. Le scan couvre :
 *   - numéros de téléphone algériens (0[5-7]XX-XX-XX-XX)
 *   - emails (regex raisonnable, mais exclut les domaines .test/.example)
 *   - NIN algérien (18 chiffres, format 1+12+1)
 *   - noms qui matchent des patterns « manifestement réels » (trop rare
 *     pour être utile, on s'en tient aux 3 ci-dessus)
 *
 * Tolérance :
 *   - les emails @x.dz, @example.com, @test.dz, @creche.local, etc. sont OK
 *   - les téléphones 0000000000 ou 0123456789 sont OK (placeholder évident)
 *   - tout le reste est flaggué
 *
 * Usage : node scripts/audit-seeds-pii.mjs [--strict]
 *   --strict : exit 1 dès qu'un match non-synthétique est trouvé
 *             (par défaut : warning, exit 0)
 *
 * Préfixe S6 (remédiation 2026-09-21, Phase 4) : sortie JSON friendly CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

// Domaines acceptés (synthétiques ou de test) — RFC 2606 + extensions métier.
// pilote.dz est le domaine EXPLICITE des comptes pilotes (cf.
// scripts/pilot/seed-pilot.mjs + docs/pilot/ONBOARDING.md) ; il n'existe pas
// dans le DNS public et n'est jamais utilisé pour de vraies adresses.
const ALLOWED_EMAIL_DOMAINS = [
  'example.com', 'example.org', 'example.net',
  'test.dz', 'test.com', 'test.local',
  'x.dz', 'creche.local', 'creche.test',
  'pilote.dz',
  'localhost',
];

// Patterns de placeholder évident (à ignorer).
const PLACEHOLDER_PHONES = ['0000000000', '0123456789', '0555000000', '0666000000'];
const PLACEHOLDER_NIN = ['000000000000000000']; // 18 zéros

// Regex.
const RE_PHONE_DZ = /0[5-7]\d{8}/g;
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const RE_NIN_DZ = /\b\d{18}\b/g;

/**
 * Décide si un match est « synthétique » (autorisé) ou « suspect »
 * (à remonter). Renvoie {ok: bool, reason: string}.
 */
function classify(match, kind) {
  if (kind === 'phone') {
    if (PLACEHOLDER_PHONES.includes(match)) return { ok: true, reason: 'placeholder' };
    // Si entouré de guillemets simples/doubles dans un VALUES, c'est un seed.
    // On NE peut pas le savoir ici — on remonte l'occurrence et le contexte.
    return { ok: false, reason: 'format DZ valide mais non-placeholder' };
  }
  if (kind === 'email') {
    const domain = match.split('@')[1].toLowerCase();
    if (ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) {
      return { ok: true, reason: 'domaine synthétique/test' };
    }
    return { ok: false, reason: `domaine ${domain} non reconnu comme synthétique` };
  }
  if (kind === 'nin') {
    if (PLACEHOLDER_NIN.includes(match)) return { ok: true, reason: 'placeholder' };
    return { ok: false, reason: '18 chiffres (format NIN DZ) non-placeholder' };
  }
  return { ok: false, reason: 'kind inconnu' };
}

const TARGETS = [
  { path: 'scripts/pilot/seed-pilot.mjs', kind: 'js' },
  ...readdirSync(join(repo, 'infrastructure/database/seeds'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ path: `infrastructure/database/seeds/${f}`, kind: 'sql' })),
];

const findings = [];
let scannedFiles = 0;
let scannedBytes = 0;

for (const t of TARGETS) {
  const full = join(repo, t.path);
  let content;
  try {
    content = readFileSync(full, 'utf8');
  } catch (e) {
    findings.push({ file: t.path, kind: 'io', match: e.message, ok: false, reason: 'lecture impossible' });
    continue;
  }
  scannedFiles += 1;
  scannedBytes += content.length;

  // En .mjs, ignorer les commentaires /** ... */ (l'en-tête déclare déjà la
  // nature synthétique du fichier).
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

  for (const [re, kind] of [
    [RE_PHONE_DZ, 'phone'],
    [RE_EMAIL, 'email'],
    [RE_NIN_DZ, 'nin'],
  ]) {
    const seen = new Set();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(stripped)) !== null) {
      const value = m[0];
      if (seen.has(value + ':' + m.index)) continue; // dedupe overlapping
      seen.add(value + ':' + m.index);
      const cls = classify(value, kind);
      findings.push({
        file: t.path,
        kind,
        match: value,
        offset: m.index,
        ok: cls.ok,
        reason: cls.reason,
      });
    }
  }
}

const suspect = findings.filter((f) => !f.ok);
const ok = findings.filter((f) => f.ok);

console.log('──────────────────────────────────────────');
console.log('AUDIT PII SEEDS (S6, Phase 4)');
console.log('──────────────────────────────────────────');
console.log(`Fichiers scannés : ${scannedFiles}`);
console.log(`Octets scannés   : ${scannedBytes}`);
console.log(`Occurrences total: ${findings.length}`);
console.log(`  ✓ synthétiques : ${ok.length}`);
console.log(`  ✗ suspectes    : ${suspect.length}`);
console.log('');

if (suspect.length === 0) {
  console.log('✓ Aucun pattern PII non-synthétique détecté.');
  console.log('  (le seed est conforme à la politique « 100% synthétique »)');
  process.exit(0);
}

// Affiche les 20 premiers suspects avec contexte.
const sample = suspect.slice(0, 20);
console.log(`Détail des ${suspect.length} occurrence(s) suspecte(s) :`);
for (const s of sample) {
  console.log(`  ✗ ${s.file}:${s.offset} [${s.kind}] ${s.match} — ${s.reason}`);
}
if (suspect.length > sample.length) {
  console.log(`  … (+${suspect.length - sample.length} autres, voir JSON ci-dessous)`);
}

// Sortie JSON pour CI.
const json = {
  generated_at: new Date().toISOString(),
  scanned_files: scannedFiles,
  scanned_bytes: scannedBytes,
  total_occurrences: findings.length,
  synthetic_count: ok.length,
  suspect_count: suspect.length,
  suspects: suspect,
};
console.log('\n---JSON---');
console.log(JSON.stringify(json, null, 2));

process.exit(strict ? 1 : 0);
