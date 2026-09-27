#!/usr/bin/env node
/**
 * Gardien « specs e2e squelettes » (remédiation 2026-09-27, lot 2).
 *
 * Le constat d'origine : deux specs Playwright étaient livrées ENTIÈREMENT
 * skippées (`test.describe.skip` + `test.skip(true, …)` par test). Elles
 * comptaient donc pour du beurre : Playwright les rapportait comme ignorées,
 * jamais comme rouges. Pire — en les ouvrant pour les compléter, on s'est
 * aperçu que leur contenu décrivait une API qui n'existe pas :
 *
 *   - POST /billing/invoices                  → n'existe pas (c'est .../generate)
 *   - POST /billing/invoices/:id/mark-overdue → n'existe NULLE PART
 *   - PATCH /payroll/entries/:id              → n'existe pas (POST .../lines)
 *   - code « PAYROLL_RUN_LOCKED »             → n'existe NULLE PART
 *
 * Un squelette n'est donc pas seulement « un test qui ne tourne pas » : c'est
 * un test qui **énonce des contre-vérités** et qu'aucune exécution ne vient
 * démentir. Ce gardien s'attaque aux deux faces.
 *
 * Contrôles
 * ─────────
 *   1. aucun `describe.skip` — une spec fichier entièrement skippée ne vaut rien.
 *   2. aucun `test.skip(true, …)` — un test inconditionnellement ignoré est un
 *      squelette, quelle que soit la raison donnée.
 *   3. tout `test.skip(cond, 'raison')` justifié : la raison doit porter une
 *      DATE (ISO) et une RÉFÉRENCE de lot/ticket. Un skip sans échéance ni
 *      propriétaire est un skip définitif qui ne dit pas son nom.
 *   4. chaque fichier de spec expose au moins UN test actif — un test dont le
 *      corps n'est qu'un `test.skip(true, …)` n'en est pas un.
 *   5. les codes d'erreur cités dans une assertion existent dans le code.
 *   6. la méthode ET le chemin des appels `request.get/post/patch/put/delete`
 *      correspondent à un décorateur de route NestJS réel. Vérifier seulement
 *      les segments aurait laissé passer `POST /billing/invoices` (la route
 *      existe en GET seulement). Les paramètres `:id` sont normalisés.
 *   7. les libellés d'interface cherchés existent dans l'i18n ou le JSX — un
 *      sélecteur mal orthographié ne casse pas la compilation : il fait
 *      expirer la spec. L'ancien squelette visait « Partiellement payé »
 *      alors que le catalogue dit « Partiellement payée ». Motif de libellés
 *      tolérant l'assemblage à l'exécution (`t('common.amount') + ' (DZD)'`).
 *      Les assertions NÉGATIVES sont exclues : elles portent sur un libellé
 *      qui n'existe justement pas.
 *
 * Usage : node scripts/check-e2e-skeletons.mjs [--verbose]
 * Sortie : 0 = conforme, 1 = au moins un défaut (liste explicite).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

const SPEC_DIRS = [join('apps', 'admin-web', 'e2e')];
/** Sources serveur servant de référence aux contrôles 5 et 6. */
const SERVER_DIRS = [
  join('apps', 'api', 'src'),
  join('apps', 'worker', 'src'),
  join('apps', 'staff-mobile', 'lib'),
  join('packages'),
  join('infrastructure'),
];

const failures = [];
const fail = (check, file, detail) => failures.push({ check, file, detail });

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
      if (['node_modules', 'dist', '.git', 'build'].includes(entry.name)) continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const specs = SPEC_DIRS.flatMap((d) => walk(d)).filter((f) => /\.spec\.ts$/.test(basename(f)));
if (specs.length === 0) {
  fail(4, SPEC_DIRS.join(', '), 'aucun fichier de spec Playwright trouvé : le garde ne peut pas passer au vert sur un dossier vide');
}

// ── Corpus serveur (pour les contrôles 5 et 6) ───────────────────────────────
const serverFiles = SERVER_DIRS.flatMap((d) => walk(d)).filter((f) =>
  /\.(ts|sql|dart|mjs|json)$/.test(basename(f)),
);
const serverCorpus = serverFiles.map((f) => readFileSync(join(repo, f), 'utf8')).join('\n');


/**
 * Registre HTTP réel extrait des décorateurs NestJS (`@Controller` +
 * `@Get/@Post/@Patch/@Put/@Delete`). Le préfixe global `/api` et la version
 * URI par défaut `v1` sont configurés dans `apps/api/src/app.factory.ts`.
 * Vérifier méthode+chemin évite le faux positif du contrôle de segments :
 * `GET /billing/invoices` existe, `POST` sur la même route non.
 */
const API_ROUTES = new Set();
const CONTROLLER_PATH = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/;
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/;
const VERSION_DECORATOR = /@Version\(\s*(['"])([^'"]+)\1\s*\)/;
for (const rel of serverFiles.filter((f) => f.endsWith('.controller.ts'))) {
  let controller = '';
  let version = '1';
  for (const line of readFileSync(join(repo, rel), 'utf8').split('\n')) {
    const c = line.match(CONTROLLER_PATH);
    if (c) {
      controller = c[1] ?? c[2] ?? '';
      version = '1';
    }
    const v = line.match(VERSION_DECORATOR);
    if (v) version = v[2];
    const route = line.match(ROUTE_DECORATOR);
    if (!route) continue;
    const method = route[1].toUpperCase();
    const endpoint = route[2] ?? route[3] ?? '';
    const path = ['api', `v${version}`, controller, endpoint]
      .filter(Boolean)
      .join('/')
      .split('/')
      .filter(Boolean)
      .map((segment) => (segment.startsWith(':') ? ':' : segment))
      .join('/');
    API_ROUTES.add(`${method} /${path}`);
  }
}

/**
 * Corpus d'INTERFACE : catalogue i18n + JSX de l'admin-web. Sert à vérifier
 * qu'un libellé cherché par Playwright existe vraiment — un sélecteur
 * orthographié de travers ne fait pas échouer la compilation, il fait
 * simplement expirer la spec au bout de 60 s, en pleine nuit, en CI.
 */
const UI_DIRS = [join('packages', 'i18n', 'src'), join('apps', 'admin-web', 'src')];
const uiCorpus = UI_DIRS.flatMap((d) => walk(d))
  .map((f) => readFileSync(join(repo, f), 'utf8'))
  .join('\n');

/**
 * Correspondance DÉLIMITÉE, pas `String.includes`.
 *
 * Contre-exemple vécu : « Partiellement payé » (l'erreur d'accord de l'ancien
 * squelette) est une SOUS-CHAÎNE de « Partiellement payée » — `includes`
 * répondait donc vrai et le contrôle 7 restait vert sur la faute même qu'il
 * était censé attraper. On exige que le libellé soit borné par des caractères
 * qui ne sont pas des lettres : devant « payée », le `e` final fait échouer la
 * recherche de « payé ».
 */
const WORD_CHAR = 'A-Za-zÀ-ÿ';
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function uiHas(text) {
  return new RegExp(`(?<![${WORD_CHAR}])${escapeRe(text)}(?![${WORD_CHAR}])`).test(uiCorpus);
}

/** Une chaîne est « connue » si elle figure telle quelle, ou si son préfixe
 *  avant « ( » y figure : `Montant (DZD)` est assemblé à l'exécution par
 *  `t('common.amount') + ' (DZD)'` et n'apparaît nulle part en entier. */
function uiKnows(text) {
  if (uiHas(text)) return true;
  const head = text.split(' (')[0];
  if (head !== text && head.length >= 3 && uiHas(head)) return true;

  // Un template literal de sélecteur (ex. `Période 02/${year} — Bulletins`)
  // ne peut pas apparaître tel quel dans le catalogue : vérifier chaque mot
  // statique plutôt que comparer le placeholder à l'interface. Une faute dans
  // le mot « Bulletins » reste ainsi détectée, sans exiger que l'i18n contienne
  // la valeur calculée de l'année.
  const staticText = text.replace(/\$\{[^}]*\}/g, ' ');
  const words = staticText.match(/[\p{L}]{3,}/gu) ?? [];
  return words.length > 0 && words.every(uiHas);
}

// ── Motifs ───────────────────────────────────────────────────────────────────
const DESCRIBE_SKIP = /\b(describe|test\.describe)\.skip\s*\(/;
const TEST_SKIP_TRUE = /\btest\.skip\(\s*true\s*,/;
const TEST_SKIP_COND = /\btest\.skip\(\s*(?!true\b)[^,]+,\s*(['"`])([\s\S]*?)\1\s*\)/g;
const DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const REF_LOT = /\b(lot|plan|ticket|issue|#\d+|P\d+|[A-Z]+-\d+)\b/i;
/** Code d'erreur applicatif : MAJUSCULES, au moins un tiret bas, assez long. */
const ERROR_CODE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,})\b/g;
/**
 * Appels Playwright à un endpoint HTTP : méthode et URL littérales dans le
 * même appel (les espaces/nouvelles lignes entre eux sont acceptés). Les
 * commentaires ne sont pas des tests ; seule l'APIRequestContext compte ici.
 */
const REQUEST_ROUTE_CALL = /\brequest\.(get|post|patch|put|delete)\s*\(\s*(['"`])([^'"`\n]+)\2/g;
/**
 * Libellés d'interface réellement cherchés par Playwright. Les rôles
 * (`getByRole('button', …)`) sont volontairement exclus : 'button' n'a aucune
 * raison d'être dans le catalogue i18n, 'Facturation' si.
 *
 * Cinq regex SÉPARÉES et non une alternation : `\1` est une référence arrière
 * NUMÉRIQUE, donc dans une alternation elle pointe le groupe 1 GLOBAL et non
 * celui de sa branche — la première version combinée ne trouvait rien du tout
 * (compteur à 0, vert sans objet). Chaque motif garde ici son propre `\1`.
 */
const SELECTOR_TEXT_RES = [
  /getByText\(\s*(['"`])([^'"`\n]+)\1/g,
  /getByLabel\(\s*(['"`])([^'"`\n]+)\1/g,
  /name:\s*(['"`])([^'"`\n]+)\1/g,
  /toContainText\(\s*(['"`])([^'"`\n]+)\1/g,
  /toHaveText\(\s*(['"`])([^'"`\n]+)\1/g,
];

const counts = { describeSkip: 0, skipTrue: 0, skipCond: 0, active: 0, codes: 0, paths: 0, routes: 0, labels: 0 };

for (const rel of specs) {
  const src = readFileSync(join(repo, rel), 'utf8');
  const lines = src.split('\n');

  // ── 1. describe.skip ───────────────────────────────────────────────────────
  lines.forEach((line, i) => {
    if (DESCRIBE_SKIP.test(line)) {
      counts.describeSkip++;
      fail(1, rel, `ligne ${i + 1} : describe entièrement skippé — ${line.trim().slice(0, 90)}`);
    }
    if (TEST_SKIP_TRUE.test(line)) {
      counts.skipTrue++;
      fail(2, rel, `ligne ${i + 1} : test inconditionnellement ignoré — ${line.trim().slice(0, 90)}`);
    }
  });

  // ── 3. skips conditionnels justifiés ───────────────────────────────────────
  for (const m of src.matchAll(TEST_SKIP_COND)) {
    counts.skipCond++;
    const reason = m[2] ?? '';
    const missing = [];
    if (!DATE_ISO.test(reason)) missing.push('une date ISO (AAAA-MM-JJ)');
    if (!REF_LOT.test(reason)) missing.push('une référence de lot/ticket');
    if (missing.length > 0) {
      fail(3, rel, `skip sans ${missing.join(' et ')} : « ${reason.slice(0, 70)} »`);
    }
  }

  // ── 4. au moins un test actif ──────────────────────────────────────────────
  // Deux pièges successifs, tous deux rencontrés en écrivant ce gardien :
  //   (a) compter les `test(` suffisait — or un squelette s'écrit justement
  //       `test('…', async () => { test.skip(true, …) })` : c'est un `test(`
  //       qui n'exécute jamais rien ;
  //   (b) retirer les lignes contenant `test.skip(` ne marche pas non plus,
  //       puisque la ligne `test('…', () => {` est conservée et continue de
  //       compter comme active.
  // On raisonne donc par PORTÉE : un `test(` est réputé squelette si le
  // premier jalon qui le suit (avant le `test(` suivant) est un `test.skip(`.
  const starts = [...src.matchAll(/\btest\s*\(\s*(['"`])/g)].map((m) => m.index);
  const skips = [...src.matchAll(/\btest\.skip\s*\(/g)].map((m) => m.index);
  const skeletonTests = starts.filter((i) => {
    const nextSkip = skips.find((j) => j > i);
    const nextStart = starts.find((k) => k > i);
    return nextSkip !== undefined && (nextStart === undefined || nextSkip < nextStart);
  });
  const activeTests = starts.length - skeletonTests.length;
  if (activeTests > 0) {
    counts.active++;
  } else {
    fail(
      4,
      rel,
      `aucun test actif : ${skeletonTests.length} test(s) ne font que se skiper eux-mêmes`,
    );
  }

  // ── 5. codes d'erreur cités dans une assertion ─────────────────────────────
  lines.forEach((line, i) => {
    // Seules les lignes d'assertion sont contrôlées : c'est là qu'un code
    // erroné fait passer un test pour une mauvaise raison. Les commentaires
    // (qui racontent justement l'historique des codes inventés) sont exclus.
    if (!/\bexpect\(/.test(line) || !/\bcode\b/.test(line)) return;
    const stripped = line.replace(/`(?:[^`\\]|\\.)*`/g, ' ');
    for (const m of stripped.matchAll(ERROR_CODE)) {
      const token = m[1];
      counts.codes++;
      if (!serverCorpus.includes(token)) {
        fail(5, rel, `ligne ${i + 1} : code « ${token} » cité dans une assertion mais introuvable dans le code serveur`);
      }
    }
  });

  // ── 6. méthode + chemin d'API comparés aux décorateurs NestJS ────────────
  for (const m of src.matchAll(REQUEST_ROUTE_CALL)) {
    const method = m[1].toUpperCase();
    const raw = m[3].trim();
    if (!/^\/api\/v1(?:\/|$)/.test(raw)) continue;
    const lineNumber = src.slice(0, m.index).split('\n').length;
    // Paramètres JS interpolés et paramètres Nest (`:invoiceId`) : même
    // segment variable, leurs noms propres ne changent pas la route.
    const path = raw
      .replace(/\$\{[^}]*\}/g, ':param')
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .map((segment) => (segment.startsWith(':') ? ':' : segment));
    const normalized = `/${path.join('/')}`;
    const key = `${method} ${normalized}`;
    counts.routes++;
    if (!API_ROUTES.has(key)) {
      fail(6, rel, `ligne ${lineNumber} : route « ${key} » absente des décorateurs NestJS — méthode ou endpoint inventé ?`);
    }
    for (const segment of path.slice(2)) {
      if (segment === ':') continue;
      counts.paths++;
      if (!serverCorpus.includes(segment)) {
        fail(6, rel, `ligne ${lineNumber} : segment d'URL « /${segment} » introuvable dans le code serveur`);
      }
    }
  }

  // ── 7. libellés d'interface ────────────────────────────────────────────────
  lines.forEach((line, i) => {
    // Une assertion NÉGATIVE (`toHaveCount(0)`, `expect(x).not`) porte
    // précisément sur un libellé ABSENT de l'interface : exiger qu'il figure
    // dans l'i18n est absurde et produisait un faux rouge sur les deux
    // assertions « aucun bouton Modifier/Supprimer ».
    if (/toHaveCount\(\s*0\s*\)|\.not\./.test(line)) return;
    for (const re of SELECTOR_TEXT_RES) {
      // Pas de `.test()` préalable : sur une regex portant le drapeau `g`,
      // lastIndex persiste entre les appels et le test sauterait une ligne sur
      // deux. matchAll suffit, et chaque motif est remis à zéro par celui-ci.
      for (const m of line.matchAll(re)) {
        const text = (m[2] ?? '').trim();
        if (text.length < 3 || !/[A-Za-zÀ-ÿ]/.test(text)) continue;
        counts.labels++;
        if (!uiKnows(text)) {
          fail(7, rel, `ligne ${i + 1} : libellé « ${text} » introuvable dans l'i18n ou le JSX — sélecteur qui ne trouvera jamais rien`);
        }
      }
    }
  });
}

// ── Rapport ──────────────────────────────────────────────────────────────────
const byCheck = new Map();
for (const f of failures) {
  if (!byCheck.has(f.check)) byCheck.set(f.check, []);
  byCheck.get(f.check).push(f);
}

const LABELS = {
  1: 'aucun describe.skip (spec entièrement skippée)',
  2: 'aucun test.skip(true, …) (squelette inconditionnel)',
  3: 'tout skip conditionnel porte date + référence de lot',
  4: 'chaque fichier expose au moins un test actif',
  5: 'codes d’erreur cités dans une assertion = existants',
  6: 'méthode + chemin d’API = route NestJS réelle',
  7: 'libellés d’interface cherchés = présents dans l’i18n ou le JSX',
};

if (verbose || failures.length > 0) {
  console.log(`Specs e2e analysées : ${specs.length}`);
  for (const [n, label] of Object.entries(LABELS)) {
    const bad = byCheck.get(Number(n)) ?? [];
    console.log(`  ${bad.length === 0 ? '✓' : '✗'} ${label}${bad.length ? ` — ${bad.length} défaut(s)` : ''}`);
  }
  if (verbose) {
    console.log(
      `  (compteurs : ${counts.describeSkip} describe.skip, ${counts.skipTrue} skip(true), ` +
        `${counts.skipCond} skip conditionnel, ${counts.active} fichier(s) avec test actif, ` +
        `${counts.codes} code(s) vérifié(s), ${counts.routes} route(s) HTTP vérifiée(s) ` +
        `(${counts.paths} segments), ${counts.labels} libellé(s) d'interface vérifié(s))`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} défaut(s) de spec e2e :`);
  for (const f of failures) console.error(`  - [${f.check}] ${f.file} : ${f.detail}`);
  console.error(
    '\nUne spec skippée ne fait pas seulement défaut à la couverture : elle peut énoncer\n' +
      "des endpoints ou des codes d'erreur qui n'existent pas, et aucune exécution ne\n" +
      'vient la démentir (c’est exactement ce qui a été trouvé dans\n' +
      'billing-overdue-flow.spec.ts et payroll-finalize-lock.spec.ts).',
  );
  process.exit(1);
}

console.log(`✓ Specs e2e : ${specs.length} fichier(s), aucun squelette, codes et endpoints réels.`);
