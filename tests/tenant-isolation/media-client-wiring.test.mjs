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
 * Le CLIENT, lui, n'a pas été rebranché : `apps/staff-mobile/lib/core/media/
 * media_uploader.dart` appelle toujours `POST /media/presign-upload`. Ce fichier
 * est **inatteignable depuis l'interface** — aucun écran ne l'instancie, aucune
 * UI de capture photo n'existe (`image_picker`/caméra absents du `lib/`), et
 * admin-web n'offre aucun téléversement. La dette est donc **latente**, pas un
 * incident de production : c'est exactement ce que documente
 * `docs/VERIFICATION_ANALYSE_2026-09-24.md` (§ lot 2, « reste ouvert »).
 *
 * Pourquoi un verrou plutôt qu'une réécriture
 * -------------------------------------------
 * Réécrire ce Dart ici produirait du code **jamais compilé ni testé** (ni SDK
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
const JUSTIFIED = new Map([
  ['apps/staff-mobile/lib/core/media/media_uploader.dart', {
    why: "chemin d'écriture historique jamais rebranché (lot 2B côté serveur, lot L3 côté client) ; "
      + 'inatteignable depuis l’UI aujourd’hui — à réécrire vers POST /media/upload AVANT de le câbler',
    requireDeadCall: true,
  }],
]);

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (CLIENT_EXT.test(entry)) acc.push(relative(REPO, full));
  }
  return acc;
};

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
  const callers = clientFiles.filter((f) => DEAD_WRITE_PRESIGN_CALL.test(readFileSync(join(REPO, f), 'utf8')));
  const unexpected = callers.filter((f) => !JUSTIFIED.has(f));
  assert.deepEqual(unexpected, [],
    `appel(s) client au presign d’écriture MORT en production (${DEAD_WRITE_PRESIGN}) :\n  `
    + `${unexpected.join('\n  ')}\n`
    + 'Action : rebrancher sur `POST /api/v1/media/upload` (multipart, lot 2B) ou — si ce fichier '
    + 'est inatteignable depuis l’UI — l’ajouter à JUSTIFIED avec sa raison.');
});

test('F5 client — chaque exception reste vraie et inatteignable depuis l’interface', () => {
  for (const [file, { why, requireDeadCall }] of JUSTIFIED) {
    const abs = join(REPO, file);
    assert.ok(existsSync(abs), `exception déclarée mais fichier absent : ${file} (raison : ${why})`);
    const source = read(file);
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
