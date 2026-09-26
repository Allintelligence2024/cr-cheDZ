#!/usr/bin/env node
/**
 * Contrat — CÂBLAGE CLIENT DU MÉDIA (F5, volet client ; lot L2C, 2026-09-25).
 *
 * Contexte (audit 2026-09-24, F5 ; plan de réparation lots 2A/2B)
 * ---------------------------------------------------------------
 * Le chemin d'écriture historique était un **presign S3** :
 * `POST /media/presign-upload` → URL signée → PUT direct du client vers MinIO.
 * En production cette URL est inatteignable (le stockage est lié à
 * `127.0.0.1:9000`, pas de sous-domaine public — décision D1 = A). Le lot 2B a
 * donc rendu le presign d'écriture **fail-closed** en production
 * (`UPLOAD_VIA_API_REQUIRED`) et livré le remplacement :
 * `POST /api/v1/media/upload` (octets écrits par le serveur).
 *
 * Le CLIENT est rebranché depuis le lot L2F (2026-09-26) :
 * `apps/staff-mobile/lib/core/media/media_uploader.dart` envoie les octets à
 * `POST /api/v1/media/upload` (multipart). Il n'y a donc plus AUCUN appelant du
 * presign d'écriture — la liste d'exceptions ci-dessous est vide, et ce fichier
 * échoue si la voie morte réapparaît (le Dart lui-même, ses reprises et sa
 * forme multipart sont prouvés par le job `flutter` : 6 tests du groupe L2F).
 *
 * Reste hors de ce contrat : **aucune UI ne capture de photo** (ni `image_picker`
 * ni caméra dans le `lib/`, aucun téléversement dans admin-web). L'uploader est
 * donc prêt mais pas encore câblé à un écran — c'est une décision produit, pas
 * une dette technique cachée.
 *
 * Historique du verrou (avant L2F)
 * --------------------------------
 * Quand il n'y avait ni SDK Flutter ni `pub.dev` dans cet environnement, réécrire ce Dart aurait
 * produit du code **jamais compilé ni testé** (ni SDK
 * Flutter ni `pub.dev` dans cet environnement : HTTP 000, mesuré deux fois —
 * lot L3). Le dépôt a une règle pour ça : aucune capacité annoncée sans preuve
 * exécutée. On verrouille donc le fait mesuré, et on rend le chemin de sortie
 * obligatoire : **le jour où un écran câble `MediaUploader`, ce test échoue**
 * avec le fichier fautif et la route à utiliser. Le correctif Dart lui-même
 * appartient au lot L3 (session/erreurs/tests + rebranchement), sur un poste
 * qui dispose du SDK.
 *
 * Ce que ce contrat NE fait pas
 * -----------------------------
 * Il ne compile rien et ne juge pas la qualité du code Dart. Il n'affirme pas
 * que la photo fonctionne : il empêche qu'on la « câble » sur un chemin mort
 * sans s'en apercevoir, et il empêche que la liste d'exceptions grandisse en
 * silence.
 *
 * Le presign des CLIPS vidéo (`/video/clips/presign-upload`) n'est pas couvert
 * ici : il l'est par la décision D5 dans `phase21-video-surveillance`
 * (cas 9, « aucun client n'envoie de clip »).
 *
 * D6 option (c) (2026-09-25) — la voie HORS-LIGNE (`command: 'add_photo'`) a été
 * RETIRÉE : le serveur la refuse explicitement (`OFFLINE_PHOTO_UNSUPPORTED`, message
 * nommant `POST /api/v1/media/upload`) et plus aucun code client ne l'enfile. Les
 * deux verrous ci-dessous interdisent sa réapparition silencieuse.
 * ici pour la même raison : elle crée une ligne `media_assets` **sans jamais
 * transférer les octets** (défaut constaté par exécution pendant le lot 2B :
 * la lecture rend `404 MEDIA_CONTENT_MISSING`), et **aucune UI ne l'appelle**
 * (aucune capture photo n'existe). Ces deux faits sont mesurés ci-dessous : le
 * jour où quelqu'un câble une UI hors-ligne — ou fait transiter les octets — la
 * CI le dit, et le dossier de décision (plan de réparation §6, D6) doit être
 * tranché au lieu d'être contourné.
 *
 * Usage : node --test tests/tenant-isolation/media-client-wiring.test.mjs
 * (aucune base, aucun Docker, aucun build : exécutable dans `quality`).
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

/** Répertoires de code CLIENT (admin-web React + les deux apps Flutter). */
const CLIENT_DIRS = ['apps/admin-web/src', 'apps/staff-mobile/lib', 'apps/parent-mobile/lib']
  .filter((d) => existsSync(join(REPO, d)));
const CLIENT_EXT = /\.(ts|tsx|js|jsx|dart)$/;

/** Chemin d'écriture MORT en production (presign S3), et son remplacement. */
const DEAD_WRITE_PRESIGN = /\/media\/presign-upload/;
/**
 * Appel RÉEL au presign mort — et non une simple mention (commentaire, en-tête,
 * documentation de fichier). Le premier jet de ce contrat comptait les mentions :
 * une mutation l'a prouvé, en remplaçant l'appel par `'/media/upload'` tout en
 * laissant le commentaire d'en-tête, le test restait vert. Un verrou qui se
 * satisfait d'un commentaire ne verrouille rien.
 *
 * Formes couvertes : `.post('/media/presign-upload'`, `.put<…>('/media/…'`
 * (Dart générique : `_api.post<Map<String, dynamic>>('/media/presign-upload'`).
 */
const DEAD_WRITE_PRESIGN_CALL = /\.(post|put|patch)\s*[<(][^\n]*['"`]\/media\/presign-upload/;
const REPLACEMENT_ROUTE = /@Post\('upload'\)/;

/**
 * Exceptions justifiées : fichiers clients qui appellent ENCORE le presign mort.
 * Chaque entrée doit rester VRAIE (le fichier doit toujours appeler le presign)
 * et INOFFENSIVE (le fichier ne doit pas être atteignable depuis l'interface).
 * Toute nouvelle entrée exige une justification écrite — et donc une décision
 * explicite, jamais un glissement silencieux.
 */
// LOT L2F (2026-09-26) : la liste d'exceptions est VIDE. `MediaUploader` a été
// rebranché sur `POST /api/v1/media/upload` (multipart, octets écrits par le
// serveur) — il n'y a donc plus aucun appelant, justifié ou non, du presign
// d'écriture mort en production. Toute réapparition est un échec du contrat.
const JUSTIFIED = new Map();

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (CLIENT_EXT.test(entry)) acc.push(relative(REPO, full));
  }
  return acc;
};

/**
 * Code sans commentaires.
 *
 * Leçon mesurée deux fois dans ce dépôt : un motif CITÉ dans un commentaire
 * n'est pas un appel. `'Bearer ${await …}'` dans un commentaire explicatif faisait
 * échouer un verrou (contrat de session parent), et cette route morte comme
 * `exif_stripped` apparaissent dans les commentaires qui expliquent *pourquoi*
 * elles ne sont plus utilisées. Les verrous ci-dessous portent donc sur le code.
 */
const codeOf = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

const clientFiles = CLIENT_DIRS.flatMap((d) => walk(join(REPO, d)));

test('F5 client — le remplacement serveur existe (cible du rebranchement)', () => {
  const controller = read('apps/api/src/modules/media/media.controller.ts');
  assert.match(controller, REPLACEMENT_ROUTE,
    'POST /media/upload (remplacement du presign, lot 2B) a disparu de media.controller.ts — '
    + 'le rebranchement client n’a plus de cible');
  const storage = read('apps/api/src/modules/media/storage.service.ts');
  assert.match(storage, /UPLOAD_VIA_API_REQUIRED/,
    'la garde fail-closed du presign d’écriture (UPLOAD_VIA_API_REQUIRED) a disparu de storage.service.ts — '
    + 'vérifier que le presign est toujours mort en production avant de « déverrouiller » le client');
});

test('F5 client — aucun client n’appelle le presign d’écriture hors exceptions justifiées', () => {
  const callers = clientFiles.filter((f) => DEAD_WRITE_PRESIGN_CALL.test(codeOf(f)));
  const unexpected = callers.filter((f) => !JUSTIFIED.has(f));
  assert.equal(JUSTIFIED.size, 0,
    'la liste d’exceptions doit rester VIDE (L2F) : tout appelant du presign mort est un échec, '
    + 'sans dérogation');
  assert.deepEqual(unexpected, [],
    `appel(s) client au presign d’écriture MORT en production (${DEAD_WRITE_PRESIGN}) :\n  `
    + `${unexpected.join('\n  ')}\n`
    + 'Action : rebrancher sur `POST /api/v1/media/upload` (multipart, lot 2B) ou — si ce fichier '
    + 'est inatteignable depuis l’UI — l’ajouter à JUSTIFIED avec sa raison.');
});

test('L2F — l’uploader appelle la route d’upload par l’API, jamais le presign', () => {
  // Le rebranchement lui-même est prouvé en Dart (job `flutter` : 6 tests du
  // groupe L2F, dont « panne de transport puis succès → 2 tentatives » et
  // « réponse 4xx → un seul essai »). Ici on verrouille ce qu'un futur commit
  // pourrait défaire sans qu'aucun test Dart ne s'en aperçoive : la route
  // appelée, et la forme multipart attendue par le serveur.
  const uploader = codeOf('apps/staff-mobile/lib/core/media/media_uploader.dart');
  assert.match(uploader, /'\/media\/upload'/,
    'l’uploader doit appeler POST /media/upload (route d’écriture par l’API, lot 2B)');
  assert.doesNotMatch(uploader, DEAD_WRITE_PRESIGN,
    'le presign d’écriture est revenu dans l’uploader — il est mort en production');
  assert.match(uploader, /MultipartFile\.fromBytes\(/,
    'le fichier doit être envoyé comme partie multipart (champ `file`)');
  assert.match(uploader, /contentType: DioMediaType\.parse\(mimeType\)/,
    'le type MIME doit être posé sur la partie : le serveur lit file.mimetype, '
    + 'sans quoi l’API refuse (MEDIA_MIME_NOT_ALLOWED)');
  assert.match(uploader, /'child_id': childId/, 'child_id doit accompagner le fichier');
  assert.match(uploader, /'checksum': checksum/,
    'le SHA-256 doit être annoncé (le serveur le VÉRIFIE : MEDIA_CHECKSUM_MISMATCH)');
  assert.doesNotMatch(uploader, /exif_stripped/,
    'le client ne retire pas les métadonnées EXIF : il ne doit pas l’affirmer');
  // Le rebranchement côté client n'a de sens que si la cible serveur existe
  // toujours : c'est le premier test de ce fichier, on ne le duplique pas.
});

test('F5 client — chaque exception reste vraie et inatteignable depuis l’interface', () => {
  for (const [file, { why, requireDeadCall }] of JUSTIFIED) {
    const abs = join(REPO, file);
    assert.ok(existsSync(abs), `exception déclarée mais fichier absent : ${file} (raison : ${why})`);
    const source = codeOf(file);
    if (requireDeadCall) {
      assert.match(source, DEAD_WRITE_PRESIGN_CALL,
        `${file} n’appelle PLUS le presign mort : l’exception est périmée — `
        + 'retirer l’entrée JUSTIFIED (sinon elle autoriserait un futur appel muet). '
        + `Raison enregistrée : ${why}`);
    }

    // Le fichier doit rester hors de l'UI : aucun AUTRE fichier client ne le référence
    // (les fichiers de test de l'app ne comptent pas : ils n'exécutent rien à l'écran).
    const className = /class\s+(\w+)/.exec(source)?.[1];
    assert.ok(className, `${file} : classe introuvable — l’exception ne peut pas être vérifiée`);
    const uiReferrers = clientFiles
      .filter((f) => f !== file && !/(^|\/)(test|tests)\//.test(f))
      .filter((f) => new RegExp(`\\b${className}\\b`).test(read(f)));
    assert.deepEqual(uiReferrers, [],
      `${className} est désormais CÂBLÉ dans l’interface :\n  ${uiReferrers.join('\n  ')}\n`
      + `Or ${file} appelle encore le presign d’écriture, mort en production `
      + '(UPLOAD_VIA_API_REQUIRED). Rebrancher sur `POST /api/v1/media/upload` AVANT de livrer '
      + 'cet écran.');
  }
});


test('D6 option (c) — la voie hors-ligne n’existe plus (aucun asset sans octets possible)', () => {
  // Décision D6, 2026-09-25 : `add_photo` est refusée explicitement et le
  // chemin d'écriture sans octets a été retiré. Ce qui était une LIMITATION
  // documentée (un asset créé sans octets ⇒ 404 MEDIA_CONTENT_MISSING à la
  // lecture) devient une impossibilité : plus de code, donc plus de dérive
  // silencieuse.
  const service = read('apps/api/src/modules/media/media.service.ts');
  assert.doesNotMatch(service, /registerFromSync/,
    'le chemin d’enregistrement SANS octets est de retour : trancher D6 à nouveau (plan §6) '
    + 'et livrer le transfert d’octets AVANT de réactiver la voie.');

  const sync = read('apps/api/src/modules/sync/sync.service.ts');
  assert.match(sync, /OFFLINE_PHOTO_UNSUPPORTED/,
    'la commande `add_photo` doit être refusée explicitement (motif nommé)');
  const branch = sync.match(/case 'add_photo':([\s\S]*?)\n      default:/);
  assert.ok(branch, 'branche `add_photo` introuvable dans sync.service.ts');
  assert.match(branch[0], /\/media\/upload/,
    'le refus doit nommer la route photo correcte (POST /api/v1/media/upload)');
  assert.doesNotMatch(branch[0], /INSERT INTO media_assets|registerFromSync/,
    'la branche refusée ne doit RIEN écrire');
});

test('D6 option (c) — plus aucun code client n’enfile de photo hors ligne', () => {
  const offenders = [];
  for (const f of clientFiles) {
    const body = codeOf(f);
    if (/enqueueOfflinePhoto/.test(body)) offenders.push(`${f} (enqueueOfflinePhoto)`);
    if (/\badd_photo\b/.test(body)) offenders.push(`${f} (commande add_photo)`);
  }
  assert.deepEqual(offenders, [],
    'la voie hors ligne a été retirée (décision D6) mais du code client la référence encore :\n  '
    + offenders.join('\n  ')
    + '\nLa photo passe par `POST /api/v1/media/upload` (octets par l’API).');
});

