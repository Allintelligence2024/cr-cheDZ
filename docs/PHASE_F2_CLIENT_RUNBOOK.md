# F2 — intégration Flutter/Drift (2026-09-14)

Lot sans déploiement. Le gate Flutter réel et les suites API sont bloquants sur
la PR #44 ; ne pas confondre un contrat réseau validé avec le gate F4 complet.

## Reproduction avant correction

- CI `34836713207`, d111fba : compilation impossible, `AppDatabase` héritait de
  `$AppDatabase` au lieu de `_$AppDatabase` ; `Value` non importé.
- Correction de compilation isolée e37852b. CI `34836989168` : les **deux vrais
  tests Flutter réseau échouent** : `/sync/push` et `/sync/pull` sont appelés sans
  appareil enregistré. Ce ne sont pas des requêtes reconstituées en Node.
- API/PG phase30 : **1/6** initialement ; duplication sur retry concurrent,
  réinscription malgré révocation, emprunt de device dans le même tenant.
  Révocation d'un autre utilisateur également reproduite rouge (**6/7**), puis
  **7/7** après correction.
- Les tests de persistance, concurrence, rollback de page, ACK ambigus, clôture
  de session et erreurs 400/401/403 couvrent le nouveau moteur ; ne pas présenter
  ces nouveaux scénarios comme tous exécutés sur l'ancien moteur non compilable.

## État local : un fichier par scope

`staffapp-v2-<organization UUID>-<user UUID>.db` : miroir, file pending, métadonnées
`sync_state`. IDs validés, normalisés, aucune interpolation de chemin libre.
L'identité extraite du token est un **namespace local**, pas une autorisation :
le JWT et le tenant sont toujours validés par l'API.

- Fingerprint UUID sauvegardé **avant** le premier POST /devices ; device_id
  sauvegardé après réponse validée. Reprise après réponse perdue avec le même
  fingerprint. Pas de réinscription par poll ni de rotation automatique après 403.
- Séquence locale allouée dans la transaction d'insertion pending ; pas de remise
  à zéro à la reconstruction du moteur ; arrêt à la limite entière sûre JS.
- Curseur texte int64 sauvegardé dans la transaction Drift de la page/projections.
  Le curseur du push n'est jamais adopté. Une page invalide/non monotone/non
  applicable est annulée entièrement, curseur inclus.
- **L'ancien `staffapp.db` et la préférence globale `sync_cursor` ne sont ni lus,
  ni supprimés, ni adoptés.** Ils n'ont pas de propriétaire utilisateur fiable.
  Les préserver pour récupération manuelle après validation explicite du scope.
  Un fichier v1 non vide présenté au migrateur v2 est refusé plutôt que réaffecté.
- Aucune promesse nouvelle de chiffrement au repos. Les fichiers par scope ne
  remplacent pas les protections du système d'exploitation.

## Appareils et prérequis serveur

POST /devices sérialise les inscriptions par verrou transactionnel PostgreSQL
sur `(tenant, utilisateur, fingerprint)`, puis relit sous RLS. Les retries
concurrents obtiennent la même identité. Métadonnées d'inscription : première
création conservée, ce n'est pas une API de renouvellement de jeton push.

- Révoqué/inactif : 403 DEVICE_REVOKED, jamais réactivé automatiquement.
- Plusieurs lignes historiques : 409 DEVICE_REGISTRATION_AMBIGUOUS. Résolution
  opérateur, **aucune suppression/fusion automatique** qui casserait des références.
- Push/pull exigent désormais `registered_by = utilisateur authentifié` en plus
  du tenant et de l'activité. Révocation self-service limitée au propriétaire
  (404 pour un device d'un autre utilisateur). Aucun nouveau privilège parent.
- Pas de migration SQL nouvelle. Les FK simples de 006 existent déjà. Ce verrou
  protège le chemin API ; il ne crée pas une contrainte composite SQL pour les
  écritures directes, point d'intégrité F3 encore distinct.

## Cycle de vie / erreurs

Un moteur, une connexion Drift et un ApiClient **à token de session fixe** par
scope. Le shell détruit les anciens widgets, arrête/cancelle le moteur et attend
sa fin avant de fermer Drift ; nouvelle instance lors de la connexion suivante.
Les réponses arrivées après clôture sont ignorées. Garde single-flight posée
avant l'attente connectivité ; listeners/timers désabonnés à l'arrêt.

- 400/autre 4xx permanent : `contractError`, bannière visible, pas de retry aveugle.
- 401 : `authenticationRequired`, reconnexion explicite ; pending conservés. Pas
  de rafraîchissement automatique de token ajouté dans ce lot.
- 403 : `deviceRevoked`/accès refusé ; arrêt, intervention nécessaire.
- Réseau/5xx/429 : état error visible + backoff 2→60s.
- ACK étranger/contradictoire : aucun acquittement local. ACK absent ou
  INTERNAL_ERROR : pending conservé. Rejets métier et conflits restent consultables
  dans la file, avec motif. F3 doit encore valider la sémantique serveur du conflit.

## Limites et rollback

**F3/F4 toujours ouverts.** Pas de producteurs child ajoutés ; bootstrap,
tombstones et ordre de commit BIGSERIAL restent à traiter. Les projections
actuellement appliquées sont child/attendance. Journal/media/type futur non pris
en charge **bloque la page sans avancer le curseur** : pas de perte silencieuse.
Ce blocage explicite interdit de présenter ce lot comme une sync complète prête
à déployer. Les autres projections et leur sémantique restent le prochain lot F3.

Pas de déploiement/SQL nouveau : rollback applicatif coordonné API + mobile.
Conserver tous les fichiers locaux (v1 et v2), ne pas renommer/rejouer une file
sous un autre compte. Ne pas réactiver l'ancien client en production : ses bugs
sont documentés dans F0. Aucun merge autorisé par ces tests.

## Gate

`node scripts/check-staff-sync.mjs` : Flutter réel, pas un mock du moteur/Drift.
Sur GitHub, Docker : image de base Cirrus 3.44.0 épinglée par digest, puis **SDK officiel
Flutter 3.47.1 au commit `6655482ec06e547f90abf8ae7590466f4415978d`**
(dépendances flutter_test correspondant au lockfile :
test_api 0.7.12, matcher 0.12.20) copie l'app dans un répertoire éphémère, fait `pub get
--enforce-lockfile`, exécute les tests et analyse l'app. Aucun SDK/fichier généré
par pub n'est committé, aucun workflow modifié. Le gate ne masque pas un exit non nul.
Les deux reproductions initiales utilisaient Flutter 3.35.4 et son graphe résolu ;
la validation finale exige le lockfile existant, sans downgrade implicite.

Résultats finaux : voir les checks du dernier HEAD et le bilan de la PR #44.
Ce gate **n'est pas** un APK Android release ni le parcours Flutter → vraie API F4.


Le premier essai sur Flutter 3.44.0 a été **refusé par --enforce-lockfile** :
le SDK aurait modifié 15 dépendances. Le minimum SDK indiqué au pied du lockfile
ne suffit pas à désigner son SDK de résolution. Les pubspec Flutter/Flutter_test
au tag 3.47.1 ont été vérifiés via GitHub ; ce SDK est épinglé sans modifier le
lockfile. Ni ce refus ni les reproductions rouges ne sont des validations F2.


L'image Cirrus 3.47.1 n'existe pas (`manifest unknown` reproduit). Le gate ne
revient pas à un SDK incompatible : il récupère le tag officiel 3.47.1 **dans
le SDK éphémère du conteneur**, vérifie son commit, puis l'utilise sur une copie
de l'app. Le dépôt applicatif est monté read-only, jamais checkout/reset par
cette opération. L'image de base est fixée au digest constaté lors du premier run.


### Régression UI de session reproduite puis corrigée

CI `34839113217` / fe48f3e : **21/22** tests Flutter ; après logout, le texte
synthétique « Private child from session A » reste dans un dialogue du Navigator.
Remplacer `home` ne retire pas les routes modales. Le MaterialApp/Navigator est
maintenant recréé à chaque epoch de session, avant d'afficher la connexion suivante.
Le test utilise le vrai shell StaffApp (services injectés), pas seulement le moteur.

L'analyse stricte a aussi détecté la mauvaise classe de ligne dans `Child.fromLocal`
(table Drift au lieu de Data) et trois éléments inutilisés du formulaire groupé.
Ils sont corrigés sans changer les règles métier. Le test d'écran vérifie le
rendu d'une vraie ligne Drift, le rechargement après sync et le bouton logout.

La batterie locale API finale est **33/33** (rôles/grants de production), 27
unitaires, build/typecheck/lint verts, audit npm production 0. La preuve Flutter
finale est celle de la CI du dernier HEAD ; pas d'exécution Flutter locale.
