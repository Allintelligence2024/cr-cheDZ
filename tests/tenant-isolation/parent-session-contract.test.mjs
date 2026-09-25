#!/usr/bin/env node
/**
 * Contrat statique — SESSION DU PORTAIL PARENTS (audit 2026-09-24, item C2 ;
 * lot L3).
 *
 * Le défaut mesuré : l'access token dure **15 minutes** et rien ne le
 * renouvelait dans `parent-mobile`. Passé ce délai, chaque appel rendait 401 :
 * les écrans affichaient une erreur générique (ou un indicateur infini) et le
 * parent devait se reconnecter — l'application était inutilisable, sans que
 * rien ne le signale avant l'incident.
 *
 * Ce fichier ne remplace pas les tests d'exécution (`apps/parent-mobile/test`,
 * joués par le job `flutter` — c'est là que la preuve est produite) : il
 * **verrouille les propriétés** qui, si elles disparaissaient, rendraient les
 * tests verts tout en cassant le comportement :
 *   1. un SEUL point d'entrée de refresh (une copie divergente ailleurs dans
 *      `lib/` produirait deux rotations concurrentes — et G1b révoque l'ancien
 *      refresh token : la seconde échouerait et déconnecterait le parent) ;
 *   2. le rafraîchissement est **single-flight par futur partagé**, pas par
 *      drapeau booléen : avec un booléen, les appels concurrents qui reçoivent
 *      401 pendant le refresh échouent au lieu d'attendre (patron employé côté
 *      staff-mobile — mesuré, pas supposé) ;
 *   3. un rejeu est marqué et borné (aucune boucle de refresh) ;
 *   4. un refresh refusé **purge** la session et prévient l'app (retour à la
 *      connexion), au lieu de laisser les jetons morts sur le téléphone ;
 *   5. les tests d'exécution existent ET sont joués par la CI (`flutter test`
 *      dans `apps/parent-mobile`) — un test que personne n'exécute ne prouve rien ;
 *   6. **aucun échec n'est masqué par un tube** : `flutter test | tee log`
 *      renvoyait le code de `tee` (0) et un test en échec laissait le job vert
 *      (mesuré en CI le 2026-09-25, run 36189792213). Les commandes passent par
 *      `scripts/ci-run.sh`, qui garde le code de sortie ET publie l'échec —
 *      « vert » doit vouloir dire « vert ».
 *
 * Usage : node --test tests/tenant-isolation/parent-session-contract.test.mjs
 * (aucune base, aucun Docker, aucun SDK Flutter : exécutable dans `quality`).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(REPO, 'apps', 'parent-mobile');
const read = (path) => readFileSync(path, 'utf8');
const LIB = join(APP, 'lib');
const TEST_DIR = join(APP, 'test');

/** Fichiers Dart de `lib/` (récursif). */
function libFiles(dir = LIB, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) libFiles(full, acc);
    else if (entry.name.endsWith('.dart')) acc.push(full);
  }
  return acc;
}

const client = read(join(LIB, 'core', 'api_client.dart'));
const main = read(join(LIB, 'main.dart'));
const workflow = read(join(REPO, '.github', 'workflows', 'flutter.yml'));

test('un seul point d’entrée de refresh dans toute l’application', () => {
  const routeRefs = libFiles().flatMap((file) =>
    read(file)
      .split('\n')
      .map((line, index) => ({ file, line: index + 1, text: line }))
      .filter(({ text }) => text.includes("'/auth/refresh'"))
      .map(({ file, line }) => `${file.slice(REPO.length + 1)}:${line}`),
  );
  assert.equal(routeRefs.length, 1, `la route de refresh doit être écrite UNE fois : ${routeRefs.join(', ')}`);
  assert.ok(routeRefs[0].endsWith('core/api_client.dart:1') || routeRefs[0].includes('core/api_client.dart'), routeRefs[0]);
});

test('le rafraîchissement est single-flight par futur partagé (pas par drapeau)', () => {
  assert.match(client, /Future<void>\?\s+_refreshInFlight;/,
    'un futur partagé doit porter le refresh en cours');
  assert.match(client, /final inFlight = _refreshInFlight;[\s\S]{0,120}return inFlight;/,
    'un appel concurrent doit ATTENDRE le refresh en cours, pas renoncer');
  // Patron rejeté explicitement : `bool _refreshing` fait échouer les appels
  // concurrents pendant le refresh (défaut du client staff-mobile).
  assert.doesNotMatch(client, /bool\s+_refreshing/,
    'un drapeau booléen ne partage pas le refresh : les 401 simultanés échouent');
});

test('le rejeu est marqué (aucune boucle de refresh possible)', () => {
  assert.match(client, /_retriedKey/, 'le rejeu doit être marqué');
  const errorHandler = client.slice(client.indexOf('Future<void> _handleUnauthorized'));
  assert.match(errorHandler, /alreadyRetried/, 'un rejeu ne doit pas re-déclencher de refresh');
  assert.match(errorHandler, /isRefreshCall/, 'la route de refresh ne doit jamais en déclencher un autre');
  assert.match(errorHandler, /handler\.resolve\(/, 'la requête doit être rejouée avec le jeton neuf');
});

test('un refresh refusé purge la session et ramène à la connexion', () => {
  const refresh = client.slice(client.indexOf('Future<void> _performRefresh'));
  assert.match(refresh, /await _expireSession\(\);/,
    'les jetons morts ne doivent pas rester dans le keystore');
  assert.match(client, /await _store\.clear\(\);/, 'la purge est bien celle du magasin de jetons');
  assert.match(client, /_onSessionExpired\?\.call\(\)/, "l'app doit être prévenue (retour à l'OTP)");
  assert.match(main, /onSessionExpired: _handleSessionExpired/,
    'main.dart doit brancher le retour à la connexion');
  assert.match(main, /_authenticated = false/, "l'état authentifié doit retomber");
});

test('les écrans distinguent session expirée, hors-ligne et panne serveur', () => {
  const errorState = read(join(LIB, 'core', 'error_state.dart'));
  assert.match(errorState, /error is ParentSessionExpired/, 'cas session expirée traité');
  assert.match(errorState, /isOffline/, 'cas hors-ligne distingué');
  assert.match(errorState, /Réessayer/, 'un réessai explicite est proposé hors session expirée');
  for (const page of ['features/feed/feed_page.dart', 'features/photos/photos_page.dart', 'features/consents/consents_page.dart']) {
    assert.match(read(join(LIB, page)), /buildApiError\(/, `${page} doit rendre un état d'erreur (jamais un chargement infini)`);
  }
});

test('les tests d’exécution existent et sont joués par la CI', () => {
  const tests = readdirSync(TEST_DIR).filter((f) => f.endsWith('.dart'));
  assert.ok(tests.length >= 2, `tests Flutter attendus (client + widget) : ${tests.join(', ')}`);
  const clientTest = read(join(TEST_DIR, 'parent_api_client_test.dart'));
  assert.match(clientTest, /expect\(fake\.refreshCalls, 1[\s\S]{0,200}concurrent|simultané/i,
    'le test doit prouver qu’un seul refresh part pour des 401 concurrents');
  // La CI doit EXÉCUTER ces tests (analyse seule = aucune preuve d'exécution).
  const runStep = workflow.match(/name: parent-mobile — tests[\s\S]*?run: \|?\s*\n?\s*(.*)/);
  assert.ok(runStep, 'étape `parent-mobile — tests` absente de flutter.yml');
  assert.match(runStep[1], /flutter test/, 'l’étape doit lancer `flutter test`');
  const parentBlock = workflow.slice(workflow.indexOf('parent-mobile — pub get + analyze'));
  assert.match(parentBlock, /working-directory: apps\/parent-mobile/,
    'les commandes parent doivent tourner dans apps/parent-mobile');
});

test('aucun échec de test Flutter n’est masqué par un tube', () => {
  // Fait mesuré en CI le 2026-09-25 (run 36189792213, job `flutter`) :
  // `flutter test | tee parent-test.log` renvoie le code de sortie de `tee`
  // (0). Un test réellement en échec laissait le job VERT — la seule trace
  // étant un `::error::4 tests passed, 1 failed.` du reporter Dart, sans
  // fichier, sans ligne, sans test nommé. Le job `flutter` ne pouvait donc pas
  // être pris pour un verdict d'exécution tant que ce tube existait.
  const runner = read(join(REPO, 'scripts', 'ci-run.sh'));
  assert.match(runner, /^set -o pipefail$/m, 'le tube doit propager l’échec (directive réelle, pas une mention en commentaire)');
  assert.match(runner, /rc=\$\?/, 'le code de sortie doit être capturé');
  assert.match(runner, /exit "\$rc"/, 'le code capturé doit être rendu au job');
  assert.match(runner, /::error title=/, 'les échecs doivent être publiés en annotations (lisibles sans artefact)');
  // Un rouge MUET ne vaut pas mieux qu'un vert faux : vécu le 2026-09-25
  // (run 36194782638, step `parent-mobile — pub get + analyze` en échec sans
  // aucune annotation, le motif ne couvrant que `error •`). Le script doit
  // capter aussi lints (`info •`/`warning •`) et échecs de résolution, et
  // publier un REPLI si rien ne correspond.
  assert.match(runner, /info •/, 'les lints doivent être captés (ils font échouer `flutter analyze`)');
  assert.match(runner, /sortie non reconnue/, 'un échec sans motif connu doit tout de même être publié');

  // Tout `| tee` d'un workflow doit être protégé : soit il passe par le script,
  // soit le step pose `set -o pipefail`. Jamais un tube nu.
  const steps = workflow.split(/\n {6}- /).slice(1);
  const withTee = steps.filter((step) => /\| tee/.test(step));
  assert.ok(withTee.length >= 4, `étapes journalisées attendues : ${withTee.length}`);
  for (const step of withTee) {
    const name = (step.match(/name: ([^\n]+)/) || [, '?'])[1];
    assert.ok(/ci-run\.sh/.test(step) || /set -o pipefail/.test(step),
      `« ${name} » redirige sa sortie avec un tube sans protéger le code de sortie`);
  }

  // Les étapes de test des DEUX apps passent par le script : un test en échec
  // rend le job rouge, et l'échec est nommé dans les annotations.
  for (const app of ['parent', 'staff']) {
    const step = workflow.match(new RegExp(`name: ${app}-mobile — tests[\\s\\S]*?(?=\\n {6}- |\\n {6}#)`));
    assert.ok(step, `étape ${app}-mobile — tests absente de flutter.yml`);
    assert.match(step[0], /ci-run\.sh/, `${app}-mobile — tests doit passer par scripts/ci-run.sh`);
    assert.match(step[0], /flutter test/, `${app}-mobile — tests doit lancer flutter test`);
  }
});

test('la résolution des dépendances parent est contrôlée, jamais implicite', () => {
  // Sans `pubspec.lock` versionné, chaque run résout ce que pub.dev sert le
  // jour J (une dépendance compromise ou simplement cassée change le binaire
  // sans qu'aucun diff ne le montre). Deux états, deux comportements — et
  // l'absence de lockfile n'est pas silencieuse : la résolution est PUBLIÉE
  // (annotations, en morceaux : une annotation est plafonnée à 4096 caractères,
  // mesuré — un envoi monobloc arrive tronqué et un lockfile tronqué ne résout
  // plus rien) pour être committée.
  const step = workflow.match(/name: parent-mobile — lockfile[\s\S]*?\n {6}- name:/);
  assert.ok(step, 'étape de contrôle du lockfile absente de flutter.yml');
  assert.match(step[0], /git ls-files --error-unmatch pubspec\.lock/, 'la présence doit être TESTÉE, pas supposée');
  assert.match(step[0], /flutter pub get --enforce-lockfile/, 'lockfile versionné ⇒ résolution contrainte');
  assert.match(step[0], /base64 -w0 pubspec\.lock/, 'lockfile absent ⇒ résolution publiée');
  assert.match(step[0], /notice title=parent-mobile pubspec\.lock \$\{index\}\/\$\{total\}/,
    'la publication doit être découpée (plafond de 4096 caractères par annotation)');
});
