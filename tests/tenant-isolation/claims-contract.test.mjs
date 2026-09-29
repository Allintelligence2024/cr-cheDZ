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
 * Ce contrat verrouille sept choses :
 *  1. « Quartz » — aucune implémentation dans le dépôt, et aucune mention de
 *     documentation qui ne soit pas une mise en garde (jamais une revendication) ;
 *  2. healthcheck Docker — la réalité mesurée (postgres partout ; api et worker
 *     en prod/staging depuis le lot 6.1 ; 0 `HEALTHCHECK` dans les Dockerfiles,
 *     les sondes étant des scripts Node appelés par Compose, sans dépendre
 *     d'outils HTTP ajoutés à l'image) ne peut pas être contredite par une
 *     phrase de documentation non qualifiée, ni par un décompte périmé ;
 *  3. compteurs revendiqués (migrations, entrées d'isolation, suites, fichiers du
 *     dossier d'isolation, ADR, runbooks, routes HTTP, chemins OpenAPI) —
 *     confrontés au DISQUE à chaque exécution ;
 *  4. workflows CI : les cinq workflows sont versionnés sous
 *     `.github/workflows/`, plus rien n'attend dans `ci-templates/`, et aucun
 *     document de référence ne peut les présenter comme « non poussés » ;
 *  5. phrases bannies : les deux affirmations fausses nommées par l'audit ne
 *     peuvent réapparaître que corrigées sur la même ligne ;
 *  6. « Limites connues » de SECURITY.md : chaque capacité retirée est
 *     confrontée au code et à son test, et les deux limites encore ouvertes
 *     restent étayées par des sources et des preuves exécutables ;
 *  7. sécurité CI : CodeQL (PR + hebdo) et Trivy (4 images, seuil HIGH/CRITICAL
 *     bloquant avant push GHCR) restent réellement câblés.
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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeTrivyReport } from '../../scripts/summarize-trivy.mjs';

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
      // Recettes locales COURANTES : leurs compteurs doivent correspondre au disque.
      // Le bloc « État de validation (2026-09-21) » reste un relevé historique
      // (76 migrations réellement exécutées ce jour-là) et ne doit pas être
      // réécrit pour refléter le présent.
      { file: 'docs/LOCAL-RUN.md', regex: /migrate \((\d+) migrations/g },
      { file: 'docs/LOCAL-RUN.md', regex: /node scripts\/migrate\.mjs\s+#\s*(\d+) migrations/g },
      { file: 'docs/LOCAL-RUN.md', regex: /PG18 : (\d+) migrations/g },
    ],
  });
});

test('compteurs — batterie d’isolation : entrées, suites, fichiers', () => {
  assertClaim({
    label: 'entrées du runner',
    actual: RUNNER_ENTRIES,
    sites: [
      { file: '.github/workflows/ci.yml', regex: /anti-bypass \+ (\d+) suites/g },
      // Le rapport daté conserve ses mesures historiques ; seul son marqueur
      // « comptage courant » est comparé au disque.
      { file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /Comptage courant 2026-09-27[^\n]*runner : (\d+) entrées/g },
      { file: 'docs/ANALYSE_PILIERS_MANQUANTS.md', regex: /(\d+) entrées/g },
      // HANDOFF et LOCAL-RUN contiennent des relevés datés, exacts à leur date.
      // Seul le marqueur actuel est une revendication d'état présent.
      { file: 'docs/HANDOFF.md', regex: /État courant 2026-09-27[^\n]*runner : (\d+) entrées/g },
      { file: 'docs/LOCAL-RUN.md', regex: /État courant du runner au 2026-09-27[^\n]*\*\*(\d+) entrées\*\*/g },
    ],
  });
  assertClaim({
    label: 'suites phaseNN',
    actual: PHASE_SUITES,
    // Les anciennes mesures datées restent dans le rapport ; vérifier uniquement
    // son marqueur courant, mis à jour avec chaque lot de la remédiation.
    sites: [{ file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /Comptage courant 2026-09-27[^\n]*suites phaseNN : (\d+)/g }],
  });
  assertClaim({
    label: 'fichiers du dossier d’isolation',
    actual: ISOLATION_FILES,
    sites: [{ file: 'docs/VERIFICATION_ANALYSE_2026-09-24.md', regex: /Comptage courant 2026-09-27[^\n]*fichiers d’isolation : (\d+)/g }],
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
// « NON poussés ». La restriction est levée depuis : les cinq workflows sont
// versionnés et leurs déclencheurs sont définis dans chaque fichier. Ce contrôle
// interdit le retour de l'état périmé dans les documents de référence.
test('workflows CI : versionnés sur disque + revendication « non poussés » bannie', () => {
  const WORKFLOWS = ['ci.yml', 'codeql.yml', 'docker.yml', 'flutter.yml', 'security-audit.yml'];
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
    `revendication périmée sur les workflows CI (ci/codeql/docker/flutter/security-audit) :\n  ${bad.join('\n  ')}`,
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

// ── 7. SECURITY.md : chaque limite connue est rapprochée d’une preuve ───────
test('SECURITY.md — « Limites connues » reflète le code et les preuves exécutables', () => {
  const security = read('SECURITY.md');
  const start = security.indexOf('**Limites connues**');
  const end = security.indexOf('\n- **Webhook**', start);
  assert.ok(start >= 0 && end > start, 'section « Limites connues » introuvable ou non délimitée');
  const section = security.slice(start, end);

  // Les deux anciennes limites doivent rester explicitement closes : une
  // phrase historique conservée sans statut deviendrait à nouveau une fausse
  // alerte pour l’opérateur.
  assert.match(section, /~~le client `staff-mobile` appelle encore le presign~~\s*→\s*\*\*CORRIGÉ\*\*/);
  assert.match(section, /~~la photo hors ligne crée un asset sans transférer les octets~~\s*→\s*\*\*RETIRÉ\*\*/);

  const openAt = section.indexOf('**Reste réellement ouvert**');
  assert.ok(openAt >= 0, 'la section ne distingue plus les limites encore ouvertes');
  const open = section.slice(openAt);
  const bulletOffsets = [...open.matchAll(/^ {4}- /gm)].map((m) => m.index);
  assert.equal(bulletOffsets.length, 2,
    `2 limites ouvertes sont attendues (upload vidéo API, retrait EXIF) ; trouvées : ${bulletOffsets.length}`);
  const bullets = bulletOffsets.map((offset, i) => open.slice(offset, bulletOffsets[i + 1] ?? open.length));
  const videoClaim = bullets.find((b) => /clips vidéo/i.test(b)) ?? '';
  const exifClaim = bullets.find((b) => /EXIF/i.test(b)) ?? '';
  assert.ok(videoClaim, 'limite « téléversement des clips vidéo par l’API » disparue sans réévaluation');
  assert.ok(exifClaim, 'limite du retrait EXIF disparue sans réévaluation');
  assert.match(videoClaim, /par l['’]API[\s\S]*?pas implémenté/i);
  assert.match(videoClaim, /peut toutefois émettre\s+un PUT en production si `S3_PUBLIC_ENDPOINT` est configuré/);
  assert.match(videoClaim, /sans cette\s+variable, il échoue explicitement en 503 `UPLOAD_VIA_API_REQUIRED`/);
  assert.match(videoClaim, /phase21-video-surveillance\.api\.test\.mjs/);
  assert.match(exifClaim, /aucun retrait EXIF n'est effectué par l'uploader `staff-mobile` ni par\s+l'upload API/i);
  assert.match(exifClaim, /transmet les octets sans les transformer/);
  assert.match(exifClaim, /le serveur conserve les octets reçus/);
  assert.match(exifClaim, /n['’]envoie pas `exif_stripped`/i);
  assert.match(exifClaim, /enregistre `false` par défaut/);
  assert.match(exifClaim, /phase67-media-upload\.api\.test\.mjs/);

  // Sources sans commentaires : un mot cité dans un commentaire ou une
  // documentation ne constitue pas une preuve du comportement du programme.
  const codeOnly = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Les deux défauts historiques corrigés restent corrigés dans les sources.
  const mobilePath = 'apps/staff-mobile/lib/core/media/media_uploader.dart';
  const mobileUploader = codeOnly(read(mobilePath));
  assert.match(mobileUploader, /_api\.upload[\s\S]{0,160}['"]\/media\/upload['"]/,
    `${mobilePath} doit envoyer les octets à POST /media/upload`);
  assert.doesNotMatch(mobileUploader, /\/media\/presign-upload/,
    `${mobilePath} a réintroduit un appel au presign d’écriture`);

  const syncService = codeOnly(read('apps/api/src/modules/sync/sync.service.ts'));
  const offlinePhoto = syncService.match(/case 'add_photo':([\s\S]*?)\n\s*default:/);
  assert.ok(offlinePhoto, 'branche serveur `add_photo` introuvable');
  assert.match(offlinePhoto[1], /OFFLINE_PHOTO_UNSUPPORTED/);
  assert.doesNotMatch(offlinePhoto[1], /INSERT INTO media_assets|registerFromSync/,
    'la commande hors ligne écrirait à nouveau un asset sans octets');
  const offlineProof = read('tests/tenant-isolation/phase77-sync-payload-guard.api.test.mjs');
  assert.match(offlineProof, /OFFLINE_PHOTO_UNSUPPORTED/);
  assert.match(offlineProof, /aucune ligne media_assets créée/);

  // La voie POST /media/upload partage une liste blanche photo/PDF. Aucune
  // route du module vidéo ne reçoit de fichier : le POST /video/clips existant
  // enregistre des métadonnées, tandis que le presign PUT n’est utilisable en
  // production que si un endpoint public est configuré.
  const mediaDto = read('apps/api/src/modules/media/dto/media.dto.ts');
  const mimeList = mediaDto.match(/export const MEDIA_MIME_TYPES\s*=\s*\[([^\]]*)\]\s*as const;/);
  assert.ok(mimeList, 'liste MEDIA_MIME_TYPES introuvable');
  const mimes = [...mimeList[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(mimes.length > 0 && !mimes.some((mime) => mime.startsWith('video/')),
    `MEDIA_MIME_TYPES accepte maintenant la vidéo : ${mimes.join(', ')} — réévaluer la limite`);
  const mediaController = codeOnly(read('apps/api/src/modules/media/media.controller.ts'));
  assert.match(mediaController, /@Post\('upload'\)[\s\S]*?FileInterceptor\('file'/,
    'le flux multipart photo de l’API ne correspond plus à la preuve documentée');

  const videoController = codeOnly(read('apps/api/src/modules/video/video.controller.ts'));
  const videoPostRoutes = [...videoController.matchAll(/@Post\('([^']+)'\)/g)].map((m) => m[1]);
  const videoUploadRoutes = videoPostRoutes.filter((path) => /upload/i.test(path));
  assert.deepEqual(videoUploadRoutes, ['clips/presign-upload'],
    `route binaire d’upload vidéo ajoutée/supprimée : ${videoUploadRoutes.join(', ')}`);
  assert.doesNotMatch(videoController, /FileInterceptor|UploadedFile/,
    'le contrôleur vidéo reçoit désormais des octets : réévaluer la limite');
  const videoService = codeOnly(read('apps/api/src/modules/video/video.service.ts'));
  assert.doesNotMatch(videoService, /^\s*(?:private\s+|protected\s+)?async\s+(?:upload|uploadClip|uploadVideo|ingestClip)\s*\(/m,
    'un chemin d’ingestion de clips par l’API est apparu : réévaluer la limite');
  assert.match(videoService, /this\.storage\.presignPut\(/,
    'le chemin de presign vidéo a changé : réévaluer la note sur S3_PUBLIC_ENDPOINT');

  const storageService = codeOnly(read('apps/api/src/modules/media/storage.service.ts'));
  assert.match(storageService,
    /if\s*\(\s*this\.config\.get<string>\('NODE_ENV'\)\s*===\s*'production'\s*&&\s*!publicEndpoint\s*\)/,
    'la portée du refus de presign en production a changé');
  const storageProof = read('apps/api/src/modules/media/storage.service.spec.ts');
  assert.match(storageProof, /production sans S3_PUBLIC_ENDPOINT[\s\S]*?503 UPLOAD_VIA_API_REQUIRED/);
  assert.match(storageProof, /production AVEC origine publique[\s\S]*?URL signée émise/,
    'la preuve doit aussi couvrir la branche où le presign est autorisé');
  const suiteRunner = read('scripts/run-isolation-suites.sh');
  assert.match(suiteRunner, /phase21-video-surveillance\.api\.test\.mjs/);
  assert.match(suiteRunner, /phase77-sync-payload-guard\.api\.test\.mjs/);

  // EXIF : vérifier le chemin de données, pas seulement l’absence d’un mot.
  // L’uploader transmet exactement l’argument bytes à MultipartFile ; l’API
  // écrit file.buffer tel quel et conserve false par défaut. Les tests Dart et
  // PostgreSQL couvrent respectivement le champ multipart et les octets en base.
  assert.match(mobileUploader, /buildForm\([\s\S]{0,180}bytes:\s*bytes/,
    'l’uploader transforme désormais les octets sans mettre à jour la limite EXIF');
  assert.doesNotMatch(mobileUploader, /exif_stripped/,
    'l’uploader déclare une suppression EXIF sans mise à jour documentaire');
  const mobileProof = read('apps/staff-mobile/test/media_uploader_phase4_test.dart');
  assert.match(mobileProof, /fields\.map\(\(f\) => f\.key\), isNot\(contains\('exif_stripped'\)\)/);

  const mediaService = codeOnly(read('apps/api/src/modules/media/media.service.ts'));
  assert.match(mediaService, /await this\.storage\.put\(storageKey, file\.buffer, file\.mimetype\)/,
    'l’API ne conserve plus les octets reçus tels quels');
  assert.match(mediaService, /exifStripped:\s*dto\.exif_stripped\s*\?\?\s*false/,
    'la valeur EXIF par défaut n’est plus false — réévaluer la limite');
  const mediaProof = read('tests/tenant-isolation/phase67-media-upload.api.test.mjs');
  assert.match(mediaProof, /readFileSync\(onDisk\)\.equals\(jpeg\)/,
    'la preuve API ne compare plus les octets stockés aux octets reçus');
  assert.match(mediaProof, /nominalRow\?\.exif_stripped === false/);
  assert.match(suiteRunner, /phase67-media-upload\.api\.test\.mjs/);
});

// ── 7. L4 : CodeQL et Trivy sont présents, et l’image est scannée avant push ─
test('sécurité CI — CodeQL sur PR/hebdo et Trivy bloquant avant GHCR', () => {
  const codeql = read('.github/workflows/codeql.yml');
  assert.match(codeql, /^name: codeql$/m);
  assert.match(codeql, /^  push:\n    branches: \[main\]/m);
  assert.match(codeql, /^  pull_request:\n    branches: \[main\]/m);
  assert.match(codeql, /schedule:[\s\S]*?cron: ['"]\d+ \d+ \* \* \d+['"]/);
  assert.match(codeql, /security-events:\s*write/);
  assert.match(codeql, /github\/codeql-action\/init@[0-9a-f]{40}\s+#\s*v4\.38\.2/);
  assert.match(codeql, /languages:\s*javascript-typescript/);
  assert.match(codeql, /build-mode:\s*none/);
  assert.match(codeql, /github\/codeql-action\/analyze@[0-9a-f]{40}\s+#\s*v4\.38\.2/);

  const docker = read('.github/workflows/docker.yml');
  const matrix = docker.match(/matrix:\s*app:\s*\[([^\]]+)\]/);
  assert.ok(matrix, 'matrice Docker des applications introuvable');
  assert.deepEqual(matrix[1].split(',').map((app) => app.trim()),
    ['api', 'worker', 'admin-web', 'support-console'],
    'Trivy doit scanner chacune des 4 images construites');
  for (const app of ['api', 'worker', 'admin-web', 'support-console']) {
    assert.match(read(`apps/${app}/Dockerfile`), /^FROM node:22\.23\.3-trixie AS build$/m,
      `${app} doit compiler avec une image Node LTS récente et une base Trixie explicite`);
  }
  for (const app of ['api', 'worker']) {
    const dockerfile = read(`apps/${app}/Dockerfile`);
    assert.match(dockerfile, /^FROM node:22\.23\.3-alpine3\.24 AS runtime$/m,
      `${app} doit exécuter sur une base Node Alpine 3.24 explicite`);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/,
      `${app} ne doit pas embarquer npm en production : l'application est lancée directement par node`);
  }
  for (const app of ['admin-web', 'support-console']) {
    assert.match(read(`apps/${app}/Dockerfile`), /^FROM nginx:1\.30\.5-alpine3\.24-slim AS runtime$/m,
      `${app} doit utiliser l'image Nginx stable sur Alpine 3.24 slim`);
  }
  assert.match(docker, /load:\s*true/,
    'le build doit charger localement l’image qui sera scannée');
  assert.match(docker, /labels:\s*\$\{\{ steps\.meta\.outputs\.labels \}\}/,
    'les labels OCI de metadata-action doivent être conservés sur l’image publiée');
  assert.match(docker, /image-ref:\s*local\/creche-saas-\$\{\{ matrix\.app \}\}:\$\{\{ github\.sha \}\}/);
  assert.match(docker, /uses:\s+aquasecurity\/trivy-action@[0-9a-f]{40}\s+#\s*v0\.36\.0/);
  assert.match(docker, /severity:\s*CRITICAL,HIGH/);
  assert.match(docker, /exit-code:\s*'1'/,
    'une vulnérabilité HIGH/CRITICAL doit bloquer la publication');
  assert.match(docker, /output:\s*trivy-results\.json/);
  assert.doesNotMatch(docker, /^\s*push:\s*(?:true|\$\{\{)/m,
    'build-push-action ne doit pas publier avant la réussite de Trivy');
  const buildAt = docker.indexOf("name: Construire l'image localement");
  const scanAt = docker.indexOf('uses: aquasecurity/trivy-action@');
  const loginAt = docker.indexOf('name: Login GHCR');
  const pushAt = docker.indexOf('docker push "$target"');
  assert.ok(buildAt >= 0 && scanAt > buildAt && loginAt > scanAt && pushAt > loginAt,
    'l’ordre exigé est build local → scan Trivy → login → push GHCR');
  assert.match(docker, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[\s\S]*?docker push/,
    'aucune publication GHCR ne doit avoir lieu hors du push sur main');
  assert.match(docker, /if: always\(\)[\s\S]*?actions\/upload-artifact@[0-9a-f]{40}[\s\S]*?trivy-results\.json/,
    'le rapport Trivy doit rester téléchargeable quand un scan échoue');
  const summaryAt = docker.indexOf('name: Résumé Trivy (résultats visibles dans le job)');
  const archiveAt = docker.indexOf('name: Archiver le rapport Trivy');
  assert.match(docker, /if: always\(\)[\s\S]*?node scripts\/summarize-trivy\.mjs trivy-results\.json/,
    'les constats Trivy doivent rester visibles dans le run même si l’artifact est inaccessible');
  assert.ok(scanAt < summaryAt && summaryAt < archiveAt && archiveAt < loginAt,
    'le résumé doit s’exécuter après le scan et avant l’archivage/publication');

  const sample = summarizeTrivyReport({ Results: [{
    Target: 'node:22-slim',
    Vulnerabilities: [
      { VulnerabilityID: 'CVE-2026-0001', PkgName: 'libc6', InstalledVersion: '2.36-9', FixedVersion: '2.36-10', Severity: 'CRITICAL' },
      { VulnerabilityID: 'CVE-2026-0002', PkgName: 'express', InstalledVersion: '4.0.0', FixedVersion: '4.0.1', Severity: 'HIGH' },
    ],
  }] }, 'api');
  assert.deepEqual(sample.counts, { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
  assert.match(sample.markdown, /CVE-2026-0001/);
  assert.equal(sample.annotations.length, 2);

  const tempDir = mkdtempSync(join(tmpdir(), 'trivy-summary-'));
  try {
    const reportPath = join(tempDir, 'report.json');
    writeFileSync(reportPath, JSON.stringify({ Results: [{
      Target: 'node:22-slim',
      Vulnerabilities: [{
        VulnerabilityID: 'CVE-2026-0001', PkgName: 'libc6', InstalledVersion: '2.36-9',
        FixedVersion: '2.36-10', Severity: 'CRITICAL',
      }],
    }] }));
    const runSummary = (githubActions) => execFileSync(
      process.execPath,
      [join(REPO, 'scripts/summarize-trivy.mjs'), reportPath],
      {
        cwd: REPO,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: githubActions, GITHUB_STEP_SUMMARY: '', TRIVY_APP: 'api' },
      },
    );
    assert.doesNotMatch(runSummary('false'), /^::(?:warning|notice)/m,
      'les commandes d’annotation GitHub ne doivent pas être émises hors Actions');
    assert.match(runSummary('true'), /^::warning title=Trivy api CRITICAL CVE-2026-0001::/m,
      'les findings doivent être annotés quand le script tourne dans GitHub Actions');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const security = read('SECURITY.md');
  assert.match(security, /CodeQL[\s\S]*?codeql\.yml/);
  assert.match(security, /default setup[\s\S]*?403/i,
    'le conflit éventuel avec Code Scanning default setup et la permission API limitée doivent rester déclarés');
  assert.match(security, /Trivy[\s\S]*?CRITICAL,HIGH/);
});
