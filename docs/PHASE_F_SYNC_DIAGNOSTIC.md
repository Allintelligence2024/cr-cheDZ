# Phase F — diagnostic F0 et lancement du contrat

Date : 2026-09-14. **Archive F0 (baseline `d5f1864`)**, pas un gate du protocole actuel.

## Suite F1/F3

Le [contrat versionné](architecture/sync-contract.md), le générateur et le client
réseau Dart sont maintenant livrés. Le serveur a été corrigé sur les curseurs :
string int64 partout, sans Number/int32, 400 avant SQL pour les valeurs invalides.
Preuve : phase29, première reproduction 5/23 puis 23/23 ; suite enrichie 26/26.
Schéma/DTO : 49/49 locaux. Le gate deux côtés exécute le Dart en CI ; aucun SDK
installé localement ou committé. L'intégration F2 est maintenant livrée ; voir `PHASE_F2_CLIENT_RUNBOOK.md`.
L'analyse ci-dessous reste l'archive F0, pas un état du dernier HEAD.

**Le runner ne lance plus `sync-f0.mjs`** : ses assertions décrivent les anciens
bugs. La couverture API positive (deux appareils, idempotence) est reprise dans
`phase29-sync-contract.api.test.mjs`. La fixture F0 est gardée telle quelle comme
preuve historique ; ne pas l'interpréter comme le résultat du dernier HEAD.

---

## Diagnostic historique

F était commencée, pas déclarée corrigée. Aucune modification Dart/API sync dans
l'étape F0 ; pas de SDK Dart/Flutter installé ou committé.

## Reproduction réelle

Commande **sur la baseline historique seulement**, après migration/seed sur cluster jetable `_test` :

```bash
node tests/diagnostics/sync-f0.mjs
```

Le diagnostic lance la vraie API et se connecte avec le rôle applicatif du gate D.
Il crée des fixtures synthétiques, authentifie une directrice, enregistre deux
appareils via HTTP, crée un enfant via HTTP, pousse une présence puis la tire
sur le second appareil. Il **ne fait pas de reset** et ferme ses pools.

**Important :** les requêtes sans device sont reconstruites d'après les littéraux
du source Dart. Le Dart n'est pas exécuté. Ce n'est ni une fixture produite par
un vrai client Dart ni le gate F4. Le programme est un **diagnostic du comportement
actuel**, avec des assertions sur les findings ; il devra être remplacé par des
tests de non-régression positifs lors des corrections F2/F3.

Résultat synthétique durable : `tests/diagnostics/fixtures/sync-f0-observed.json`.
Aucun token, UUID d'utilisateur, téléphone ou donnée réelle dans ce résultat.

| Finding | Résultat observé |
|---|---|
| Staff `SyncClient.push` n'envoie que `operations` | HTTP **400**, `device_id` obligatoire |
| Staff `SyncClient.pull` n'envoie que `cursor` | HTTP **400**, `device_id` obligatoire |
| Pas d'enregistrement d'appareil par le client staff | Aucun appel `/devices` dans ce parcours ; l'API répond `{device_id}`, pas `{id}` |
| Création HTTP d'enfant réussie | HTTP 201, puis **0 événement child** au pull |
| Curseur d'un push | JSON **number**, SQL `MAX(sync_seq)::int` (plafond int32 à traiter) |
| Curseur d'un pull contenant un événement | JSON **string**, OID BIGINT de pg ; le cast TypeScript n'effectue aucune conversion |
| Curseur d'un pull vide après reprise | JSON **number** ; même champ, type instable selon les lignes |
| Idempotence API après enregistrement correct | Même event_id accepté au rejeu ; second pull sans doublon |

Le parseur Dart `result['next_cursor'] as int?` ne peut donc pas accepter la
réponse non vide. Le curseur est actuellement dans **SharedPreferences** sous
la clé globale `sync_cursor`, pas dans Drift et pas scopé tenant/utilisateur.
La séquence locale repart à zéro après reconstruction du moteur ; les listeners
de connectivité ne sont pas désabonnés et les erreurs 400/401 sont regroupées en
un retry générique. Ces derniers points sont des observations de code à tester
avant correction, pas des bugs runtime déjà tous reproduits.

## Faux raccourci à éviter

`parent-mobile` ne possède pas ce moteur de sync. Les endpoints `/sync/*` sont
réservés aux rôles staff. « Pas de device_id dans parent » ne démontre donc pas
un 400 de sync parent. **Ne pas ouvrir la sync staff aux parents** pour faire
passer un test : cela pourrait exposer des données d'autres enfants.

## Prochain lot F1–F4

1. Figer le contrat versionné, avec fixtures réellement émises par Dart et
   schéma partagé. Désormais livré : `architecture/sync-contract.md`.
2. Device stable, enregistré avant push/pull et lié au tenant + utilisateur ;
   définir l'idempotence d'enregistrement et le comportement en cas de révocation.
3. Curseur décimal opaque (proposition string), borné en int64 SQL sans passage
   par un Number JS ou un int32 ; compatibilité des anciens clients à décider.
4. Sauvegarde atomique dans Drift du curseur et de l'application de la page ;
   isolation des scopes et annulation d'une sync lors du changement de session.
5. Projection minimale des événements `child`, tombstones, bootstrap initial et
   émetteurs de tous les chemins d'écriture. Pas de `c.*` dans le changelog.
6. Vérifier l'ordre de commit : une séquence BIGSERIAL n'est pas à elle seule un
   ordre de commit. Reproduire une transaction A lente/B rapide avant de choisir
   pagination/outbox/verrou ; ne pas sauter silencieusement un événement tardif.
7. Vrai client Dart → deux appareils → reprise → conflit → changement de tenant,
   en CI avec SDK hors Git. À défaut, fixtures réelles Dart validées contre les DTO.

Le gate E2 est validé en CI Docker (PR #44, commit 955b9cd) ; cela ne prouve en rien
que F est fonctionnelle. Aucune migration F ajoutée ici ; 055 reste réservée à G2.
