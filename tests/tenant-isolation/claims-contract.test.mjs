#!/usr/bin/env node
/**
 * Test de contrat — VÉRITÉ DOCUMENTAIRE (lot 5 du plan de réparation 2026-09-24).
 *
 * Objet : rendre impossible le « regonflage » documentaire constaté par l'audit du
 * 2026-09-24 — des documents qui annonçaient des capacités absentes du dépôt
 * (« QuartzJobs », « HEALTHCHECK présent sur les services », compteurs périmés)
 * alors que TOUTES les suites passaient au vert. Aucun test de code ne pouvait
 * attraper cela : le code était sain, la documentation mentait.
 *
 * Ce contrat verrouille cinq choses :
 *  1. « Quartz » — aucune implémentation dans le dépôt, et aucune mention de
 *     documentation qui ne soit pas une mise en garde (jamais une revendication) ;
 *  2. healthcheck Docker — la réalité mesurée (postgres partout ; api et worker
 *     en prod/staging depuis le lot 6.1 ; 0 `HEALTHCHECK` dans les Dockerfiles,
 *     les sondes étant des scripts Node appelés par Compose — l'image
 *     `node:22-slim` n'a ni curl ni wget) ne peut pas être contredite par une
 *     phrase de documentation non qualifiée, ni par un décompte périmé ;
 *  3. compteurs revendiqués (migrations, entrées d'isolation, suites, fichiers du
 *     dossier d'isolation, ADR, runbooks, routes HTTP, chemins OpenAPI) —
 *     confrontés au DISQUE à chaque exécution ;
 *  4. workflows CI (ajout du 25/09/2026) : les quatre workflows sont versionnés
 *     sous `.github/workflows/`, plus rien n'attend dans `ci-templates/`, et
 *     aucun document de référence ne peut les présenter comme « non poussés »
 *     (épisode historique de la permission `workflows`) ;
 *  5. phrases bannies : les deux affirmations fausses nommées par l'audit ne
 *     peuvent réapparaître que corrigées sur la même ligne.
 *
 * Conventions assumées (et pourquoi) :
 *  - TOUTE la documentation est scannée (y compris les rapports datés) : un
 *    document qui décrit un état passé doit le dire par sa date, il ne peut pas
 *    affirmer une capacité au présent. Les compteurs de volumétrie, eux, ne sont
 *    verrouillés que dans les documents de référence (`REFERENCE_DOCS`) ;
 *  - une mesure de volumétrie brute de fichiers porte sa DATE dans la phrase
 *    (« … fichiers au 2026-09-24 ») : c'est une mesure, pas une propriété
 *    permanente — le contrat ne verrouille donc que les compteurs stables par
 *    intention (migrations, suites, ADR, runbooks, routes) ;
 *  - un écart fait échouer la CI avec la valeur réelle : mettre à jour le
 *    document, jamais le contrat (sauf décision explicite de changer de règle).
 *
 * Usage : node --test tests/tenant-isolation/claims-contract.test.mjs
 * (aucune base, aucun Docker : exécutable dans le job `quality`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out']);

/** Parcours récursif du dépôt (hors artefacts et dépendances). */
function walk(dir, predicate, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

const rel = (file) => relative(REPO, file);
/** Accepte un chemin relatif au dépôt comme un chemin absolu (parcours récursif). */
const read = (file) => readFileSync(file.startsWith('/') ? file : join(REPO, file), 'utf8');
const lines = (file) => read(file).split('\n');

/** Toutes les lignes de documentation du dépôt. */
function docFiles() {
  return walk(REPO, (p) => p.endsWith('.md'));
}

/**
 * Lignes fautives : celles qui matchent `pattern` sans matcher une seule des
 * formes autorisées. Renvoie des « fichier:ligne » lisibles dans l'échec.
 */
function offenders(files, pattern, allowed) {
  const bad = [];
  for (const file of files) {
    lines(file).forEach((line, index) => {
      if (!pattern.test(line)) return;
      if (allowed.some((ok) => ok.test(line))) return;
      bad.push(`${rel(file)}:${index + 1} → ${line.trim().slice(0, 120)}`);
    });
  }
  return bad;
}

/** Toutes les captures d'un motif dans un fichier (≈ les valeurs revendiquées). */
function captures(file, regex, group = 1) {
  return [...read(file).matchAll(regex)].map((m) => m[group]);
}

/** Le document ne peut revendiquer QUE la valeur mesurée. */
function assertClaim({ label, actual, sites }) {
  for (const { file, regex, group = 1 } of sites) {
    const claimed = captures(file, regex, group);
    assert.ok(
      claimed.length > 0,
      `${label} : aucune revendication trouvée dans ${file} (motif ${regex}) — la revendication a-t-elle disparu ?`,
    );
    for (const value of claimed) {
      // « 075 » et « 75 » disent la même chose : comparer en nombre quand les
      // deux côtés sont numériques, sinon en chaîne (formes composites).
      const same = /^\d+$/.test(String(value)) && /^\d+$/.test(String(actual))
        ? Number(value) === Number(actual)
        : String(value) === String(actual);
      assert.ok(same, `${label} : ${file} revendique « ${value} », la réalité est « ${actual} »`);
    }
  }
}

// ── Mesures réelles (recalculées à chaque exécution) ────────────────────────
const MIGRATIONS = walk(join(REPO, 'infrastructure', 'database', 'migrations'), (p) => p.endsWith('.sql')).length;
const ISOLATION_DIR = join(REPO, 'tests', 'tenant-isolation');
const ISOLATION_FILES = readdirSync(ISOLATION_DIR).filter((f) => f.endsWith('.mjs')).length;
const PHASE_SUITES = readdirSync(ISOLATION_DIR).filter((f) => /^phase\d+.*\.test\.mjs$/.test(f)).length;
const RUNNER_ENTRIES = (() => {
  const block = read('scripts/run-isolation-suites.sh').match(/SUITES=\(([\s\S]*?)\n\)/)[1];
  return block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
})();
const ADRS = readdirSync(join(REPO, 'docs', 'adr')).filter((f) => f.endsWith('.md') && f !== 'adr-template.md').length;
const RUNBOOKS = readdirSync(join(REPO, 'docs')).filter((f) => /RUNBOOK.*\.md$/.test(f)).length;
const OPENAPI_PATHS = [...read('packages/api-contracts/openapi.yaml').matchAll(/^ {2}(\/[^\s:]+):\s*$/gm)].length;
const INVENTORY = execFileSync(process.execPath, ['scripts/inventory-route-guards.mjs'], { cwd: REPO, encoding: 'utf8' });
const ROUTES = Number(INVENTORY.match(/(\d+) routes HTTP inventoriées/)[1]);
const UNGUARDED = Number(INVENTORY.match(/(\d+) sans @Roles ni @Public/)[1]);

/**
 * Documents « de référence » : ceux qui décrivent l'ÉTAT COURANT du produit et
 * sont donc soumis au contrat. Les rapports datés (P3-RAPPORT, CURSOR-*,
 * PLAN_IMPLEMENTATION, CI-RESTORE…) décrivent un état historique : les exclure
 * est un choix explicite, pas un oubli — les réécrire serait falsifier l'histoire.
 */
const REFERENCE_DOCS = [
  'README.md',
  'SECURITY.md',
  'HANDOFF-AGENT-ANTIGRAVITY.md',
  'docs/HANDOFF.md',
  'docs/LOCAL-RUN.md',
  'docs/VERIFICATION_ANALYSE_2026-09-24.md',
  'docs/PLAN_REPARATION_2026-09-24.md',
  'docs/ANALYSE_PILIERS_MANQUANTS.md',
  'docs/CI-DATABASE-JOB-FINDINGS.md',
  'docs/PLAN_REMEDIATION_FINAL.md',
  'ci-templates/README.md',
].map((f) => join(REPO, f));

// ── 1. « Quartz » : aucune implémentation, aucune revendication ─────────────
test('F1 — « Quartz » n’existe pas dans le dépôt et n’est jamais revendiqué', () => {
  // Le contrat lui-même nomme « Quartz » : il se cite, il ne l'implémente pas.
  const self = join(REPO, 'tests', 'tenant-isolation', 'claims-contract.test.mjs');
  const sources = ['apps', 'packages', 'scripts', 'infrastructure', 'tests', '.github']
    .flatMap((dir) => walk(join(REPO, dir), (p) => /\.(ts|tsx|mjs|js|sql|ya?ml|json)$/.test(p)))
    .filter((f) => f !== self);
  const implemented = sources.filter((f) => /quartz/i.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(
    implemented,
    [],
    `implémentation « Quartz » inattendue (l'ordonnancement est en base : scheduler_ticks) : ${implemented.join(', ')}`,
  );

  const bad = offenders(docFiles(), /quartz/i, [
    /n'existe/i,            // « aucun Quartz n'existe »
    /aucun/i,
    /0 occurrence/i,
    /interdire/i,           // règle du lot 5 citant le mot
    /laissait croire/i,     // mise en garde sur le rapport d'origine
    /❌/,
    /grep -ri quartz/i,     // commande de recherche, jamais une affirmation
    /« ?QuartzJobs/i,       // le nom de l'affirmation auditée, entre guillemets
  ]);
  assert.deepEqual(bad, [], `mention de « Quartz » sans mise en garde :\n  ${bad.join('\n  ')}`);
});

// ── 2. Healthcheck Docker : la réalité mesurée, et personne ne la dépasse ───
/** Contenu d'un service (bloc YAML d'indentation 2 espaces, borné au suivant). */
function serviceBlock(source, service) {
  const m = source.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  \\S|\\Z)`, 'm'));
  return m ? m[1] : null;
}

/** Services propriétaires d'un bloc `healthcheck:` (indentation 4 espaces). */
function healthcheckOwners(source) {
  const owners = [];
  let service = null;
  for (const line of source.split('\n')) {
    const serviceLine = line.match(/^ {2}([a-z0-9_-]+):\s*$/);
    if (serviceLine) service = serviceLine[1];
    if (/^ {4}healthcheck:/.test(line)) owners.push(service);
  }
  return owners;
}

/**
 * Propriétaires attendus, par fichier — l'état RÉEL, daté du lot 6.1 :
 * postgres partout ; api + worker en prod et en staging (images compilées,
 * sondes `dist/healthcheck.js`). En dev, les conteneurs montent `src/` et
 * compilent à chaud : la sonde n'y est pas garantie au démarrage, l'absence est
 * documentée dans le fichier — un décompte générique serait ici un mensonge.
 */
const HEALTHCHECK_OWNERS = {
  'docker-compose.prod.yml': ['postgres', 'api', 'worker'],
  'docker-compose.staging.yml': ['postgres', 'api', 'worker'],
  'docker-compose.dev.yml': ['postgres'],
};

test('F2 — healthcheck Docker : les services réellement sondés, par fichier ; 0 dans les Dockerfiles', () => {
  for (const [file, expected] of Object.entries(HEALTHCHECK_OWNERS)) {
    const owners = healthcheckOwners(read(`infrastructure/docker/${file}`));
    assert.deepEqual(
      owners,
      expected,
      `${file} : healthcheck attendus ${JSON.stringify(expected)} (mesuré : ${JSON.stringify(owners)})`,
    );
  }
  const dockerfiles = walk(REPO, (p) => /Dockerfile/.test(p) && !SKIP_DIRS.has(p.split('/').slice(-2)[0]));
  const withHealthcheck = dockerfiles.filter((f) => /^\s*HEALTHCHECK/mi.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(withHealthcheck, [], `HEALTHCHECK inattendu dans : ${withHealthcheck.join(', ')}`);
  // Les sondes déclarées par Compose doivent exister dans la SOURCE (`dist/` est
  // un artefact de build, absent du dépôt) : une sonde renommée laisserait un
  // conteneur éternellement « unhealthy » sans que rien ne le signale. La
  // recherche se fait DANS le bloc du service (un motif qui déborderait sur le
  // service suivant attribuerait la sonde de l'API à `postgres`).
  for (const [file, owners] of Object.entries(HEALTHCHECK_OWNERS)) {
    const source = read(`infrastructure/docker/${file}`);
    for (const service of owners) {
      // Toute sonde Node du bloc est contrôlée, quelle que soit son extension :
      // un renommage (« healthcheck.js » → autre chose) doit se voir ici.
      const probe = serviceBlock(source, service)?.match(/node\s+(apps\/[^\s"]+)\/dist\/([^\s"]+\.js)/);
      if (!probe) continue; // postgres : sonde `pg_isready`, pas un script Node
      const sourceFile = `${probe[1]}/src/${probe[2].replace(/\.js$/, '.ts')}`;
      assert.ok(
        existsSync(join(REPO, sourceFile)),
        `${file}/${service} : sonde ${probe[1]}/dist/${probe[2]} mais ${sourceFile} est introuvable`,
      );
    }
  }
});

test('F2 — un décompte de healthchecks cité dans la doc correspond au disque', () => {
  // Forme verrouillée : `grep -c healthcheck <fichier>  # <n> …`. Le jour où un
  // service gagne (ou perd) une sonde, la ligne de mesure devient fausse : le
  // contrat rougit au lieu de laisser un chiffre périmé dans un rapport.
  const bad = [];
  for (const file of docFiles()) {
    lines(file).forEach((line, index) => {
      const m = line.match(/grep -c healthcheck\s+(\S*docker-compose[\w.-]*\.yml)[^#]*#\s*(\d+)/i);
      if (!m) return;
      const compose = m[1].replace(/^.*?(infrastructure\/docker\/)/, '$1');
      if (!existsSync(join(REPO, compose))) return; // citation d'un fichier d'un autre dépôt
      const actual = healthcheckOwners(read(compose)).length;
      if (Number(m[2]) !== actual) {
        bad.push(`${rel(file)}:${index + 1} → cite ${m[2]} healthcheck(s) dans ${compose}, mesuré : ${actual}`);
      }
    });
  }
  assert.deepEqual(bad, [], `décompte de healthcheck périmé :\n  ${bad.join('\n  ')}`);
});

test('F2 — aucune documentation ne revendique une couverture healthcheck non qualifiée', () => {
  const bad = offenders(docFiles(), /healthcheck/i, [
    /postgres/i,                   // nomme le seul service réellement couvert
    /1 seul/i,
    /aucun|n'existe|n'expose|pas de|pas un|sans /i, // négation
    /\/health|healthcheck public|endpoint|HTTP/i,   // parle du contrôle HTTP, pas de Docker
    /\[ \]/,                       // case à cocher NON faite : une intention, pas un acquis
    /optionnel|stub|planifié|à faire|décision/i,    // objectif de lot, pas une capacité livrée
    /« ?healthcheck[^»]*»/i,      // le mot cité entre guillemets (affirmation auditée ou corrigée)
    /non qualifiée/i,              // qualifie explicitement l'affirmation
    /❌/,                          // ligne de tableau qui marque l'affirmation comme fausse
    /grep -c healthcheck/i,        // commande de MESURE (le résultat est la ligne suivante)
    /mutation/i,                   // décrit une MUTATION du contrat, pas une capacité
    /not ok|rc=1/,                 // sortie de test citée (preuve), jamais une affirmation
    /fausse?s?\b|généralisé/i,      // qualifie explicitement l'affirmation de fausse
  ]);
  assert.deepEqual(bad, [], `affirmation healthcheck non qualifiée :\n  ${bad.join('\n  ')}`);
});

// ── 3. Compteurs revendiqués = compteurs mesurés ────────────────────────────
test('compteurs — migrations : les recettes courantes ne mentent pas', () => {
  assert.ok(MIGRATIONS >= 75, `migrations sur disque : ${MIGRATIONS}`);
  assertClaim({
    label: 'migrations',
    actual: MIGRATIONS,
    sites: [
      // Libellé du job CI (« Migrations (reset + status 001→075) »).
      { file: '.github/workflows/ci.yml', regex: /001→(\d{3})/g },
      // Recette locale : toute mention « N migrations » doit dire la vérité.
      { file: 'docs/LOCAL-RUN.md', regex: /(\d+)\s+migrations/g },
    ],
  });
});

test('compteurs — batterie d’isolation : entrées, suites, fichiers', () => {
  assertClaim({
    label: 'entrées du runner',
    actual: RUNNER_ENTRIES,
    sites: [
      { file: '.github/workflows/ci.yml', regex: /anti-bypass \+ (\d+) suites/g },
      { file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /\*\*(\d+)\*\* entrées/g },
      { file: 'docs/ANALYSE_PILIERS_MANQUANTS.md', regex: /(\d+) entrées/g },
      { file: 'docs/HANDOFF.md', regex: /(\d+) entrées/g },
      { file: 'docs/LOCAL-RUN.md', regex: /\*\*(\d+)\s*\n?\s*entrées\*\*/g },
    ],
  });
  assertClaim({
    label: 'suites phaseNN',
    actual: PHASE_SUITES,
    sites: [{ file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /\*\*(\d+)\*\* suites `phaseNN`/g }],
  });
  assertClaim({
    label: 'fichiers du dossier d’isolation',
    actual: ISOLATION_FILES,
    sites: [{ file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /\*\*(\d+)\*\* fichiers dans/g }],
  });
});

test('compteurs — ADR et runbooks (volumétrie vérifiable)', () => {
  const claimed = captures('docs/VERIFICATION_ANALYSE_2026-09-24.md', /(\d+) ADR \/ (\d+) runbooks/g, 0);
  assert.ok(claimed.length > 0, 'la volumétrie ADR/runbooks doit rester annoncée dans la vérification');
  for (const line of claimed) {
    assert.equal(line, `${ADRS} ADR / ${RUNBOOKS} runbooks`, `volumétrie revendiquée « ${line} » vs réelle « ${ADRS} / ${RUNBOOKS} »`);
  }
});

test('compteurs — routes HTTP et chemins OpenAPI', () => {
  assertClaim({
    label: 'routes HTTP inventoriées',
    actual: ROUTES,
    sites: [
      { file: '.github/workflows/ci.yml', regex: /Inventaire des gardes de route \((\d+) routes/g },
      { file: 'docs/PLAN_REPARATION_2026-09-24.md', regex: /→ (\d+) routes \(/g },
      { file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /chemins écrits à la main sur (\d+) routes/g },
    ],
  });
  assertClaim({
    label: 'chemins OpenAPI écrits à la main',
    actual: OPENAPI_PATHS,
    sites: [{ file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /OpenAPI : (\d+) chemins/g }],
  });
  assert.ok(UNGUARDED > 0, `routes sans @Roles ni @Public mesurées : ${UNGUARDED}`);
});

// ── 5. Workflows CI : versionnés, et aucun document de référence ne dit le contraire ─
//
// Épisode historique : la GitHub App de poussée n'avait pas la permission
// `workflows` — les workflows vivaient dans `ci-templates/` et la doc disait
// « NON poussés ». La restriction est levée depuis : les 4 workflows sont sous
// `.github/workflows/` et tournent à chaque push. Ce contrôle mesure la réalité
// et interdit le retour de l'état périmé dans les documents de référence.
test('workflows CI : versionnés sur disque + revendication « non poussés » bannie', () => {
  const WORKFLOWS = ['ci.yml', 'docker.yml', 'flutter.yml', 'security-audit.yml'];
  for (const wf of WORKFLOWS) {
    const abs = join(REPO, '.github', 'workflows', wf);
    assert.ok(existsSync(abs), `workflow absent du disque : .github/workflows/${wf}`);
    assert.ok(read(abs).trim().length > 0, `workflow vide : .github/workflows/${wf}`);
  }

  // Le répertoire de transit de l'époque ne doit plus contenir de workflow en attente.
  const pending = walk(join(REPO, 'ci-templates'), (f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.deepEqual(
    pending.map(rel), [],
    `des workflows dorment encore hors de .github/workflows/ : ${pending.map(rel).join(', ')}`,
  );

  // Aucun document de référence ne peut présenter les workflows comme non poussés.
  const stale = /non poussé|pas poussé|locaux uniquement|permission\s+`?workflows`?|n'a pas la permission workflows/i;
  const historic = /historique|désormais levé|levée|était|avai(ent|t) été|bloqu|épisode/i;
  const bad = offenders(REFERENCE_DOCS, stale, [historic]);
  assert.deepEqual(
    bad, [],
    `revendication périmée sur les workflows CI (la CI tourne : ci/docker/flutter/security-audit) :\n  ${bad.join('\n  ')}`,
  );
});

// ── 6. Phrases bannies : les affirmations fausses de l'audit ────────────────
test('les affirmations fausses de l’audit ne peuvent revenir que corrigées sur la même ligne', () => {
  const banned = [
    { pattern: /HEALTHCHECK\s+présent\s+sur\s+les\s+services/i, why: 'F2 — un seul healthcheck, sur postgres' },
    { pattern: /QuartzJobs?\s+pour\s+(la\s+)?purge/i, why: 'F1 — aucun Quartz dans le dépôt (scheduler en base)' },
    { pattern: /presignGet\s*\(/i, why: 'F5 — la signature de lecture a été supprimée (volet A du lot 2)' },
  ];
  const corrected = /❌|→|1 seul|aucun|n'existe|supprim|c'est faux|était faux|fausse|interdit|bannie/i;
  const bad = [];
  for (const file of docFiles()) {
    lines(file).forEach((line, index) => {
      for (const { pattern, why } of banned) {
        if (pattern.test(line) && !corrected.test(line)) {
          bad.push(`${rel(file)}:${index + 1} (« ${why} ») → ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
  assert.deepEqual(bad, [], `affirmation fausse non corrigée :\n  ${bad.join('\n  ')}`);
});
