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
 *      dans `apps/parent-mobile`) — un test que personne n'exécute ne prouve rien.
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
