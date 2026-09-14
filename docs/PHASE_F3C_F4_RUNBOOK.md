# F3c / F4 — ordre de publication et vrai client contre API

2026-09-14. Branche Arena, PR #44. Aucun merge ni déploiement.

## Reproductions

Commit **7d0b520** : tests/gate uniquement, avant correction.

- F3c, vrai PostgreSQL NOBYPASSRLS et vrai pull HTTP : **2/8** contrôles verts.
  A insère sans committer ; B insère et committe ; le pull reçoit B ; après COMMIT
  de A, son événement est définitivement sauté. Même perte avec B = 501 événements.
  Le test attend un COMMIT réel ou un `pg_stat_activity.wait_event_type = Lock`,
  pas un délai supposé suffisant. Rollback de A et indépendance des tenants sont
  déjà verts avant correction, pas présentés comme des défauts.
- Séquence explicite, UPDATE de séquence/payload et DELETE applicatif sont aussi
  reproduits : ils contournent un journal destiné à être consommé par curseur.
- F4, CI **34850291356**, check **103996216914** : **3/5** vrais tests Flutter
  contre la vraie API passent. Deux rouges : `session_date` vaut
  `2026-09-14T00:00:00.000Z` au lieu de `2026-09-14`, et la version du miroir vaut
  **0 au lieu de 1**. Les échanges HTTP, le rejeu/conflit et la reconnexion ne
  sont pas remplacés par un FakeApi.
- Les deux défauts de projection sont aussi reproduits côté API local : **8/10**
  après la correction d'ordre seule, puis **10/10** après les corrections de date
  et de version. Le résultat Flutter final est celui du dernier HEAD de la PR.

## F3c : allocation après verrou, pas après nextval

Migration additive **060_sync_publication_order.sql**. 001–059 restent inchangées,
055 demeure réservée à G2. Sous verrou exclusif de mise à niveau, la migration
aligne la séquence sur les valeurs existantes et retire le default BIGSERIAL.

Le trigger BEFORE INSERT, **SECURITY INVOKER**, prend le verrou transactionnel
`hashtextextended(organization_id,48273)` **avant** d'appeler `nextval`. Le default
était évalué avant un trigger BEFORE : conserver ce default aurait gardé le bug.

- Verrou conservé jusqu'au COMMIT/ROLLBACK ; les lignes visibles d'un tenant
  forment un préfixe committé. Une transaction peut publier plusieurs événements.
- Autres tenants indépendants ; trous de séquence après rollback autorisés.
- Le pull reste un SELECT MVCC, tri BIGINT numérique, pages de 500, curseur int64
  string. Pas de verrou écrivain pris par le lecteur ni de modification de l'enveloppe.
- Avant le verrou, un écrivain non privilégié doit avoir le tenant RLS demandé et
  ne peut fournir `sync_seq`. Le journal est append-only pour ce rôle : UPDATE et
  DELETE refusés. Les producteurs child/attendance/journal/media passent tous
  par cette table ; aucune allocation manuelle anticipée dans les services.
- Les opérateurs superuser/BYPASSRLS conservent leurs capacités de maintenance
  (notamment fixtures int64 F1 et purges synthétiques). **Leurs réécritures ou IDs
  explicites ne font pas partie du protocole de publication normal** : maintenance
  exclusive et procédure de reprise nécessaires, jamais un chemin applicatif.
- Ce choix sérialise les publications d'un même tenant. Des transactions longues
  peuvent retarder ses écritures ; un deadlock éventuel entraîne un rollback,
  pas un faux ACK (F3a). Les retries conservent les event_id. Pas de promesse de
  débit illimité ni de réparation automatique des événements sautés avant 060.

## Corrections de projection révélées par F4

La date du jour à Alger est lue en SQL `date::text` avant sérialisation du changelog,
au lieu de laisser pg créer une Date JavaScript. La version de la session résultant
**de cette commande** est lue dans la même transaction et publiée. Le client Drift
la conserve dans `serverVersion`, utilisable comme base optimiste.

Les anciens événements déjà écrits ne sont pas réinterprétés à partir d'un état
courant : pas de version historique inventée, pas de backfill aveugle. Les vieilles
projections peuvent manquer de version ou porter l'ancien timestamp. Une éventuelle
reprise de données historiques devra être explicite, avec sauvegarde et conservation
des opérations locales. L'installation de cette session reste neuve/hors production.

## F4 : ce qui s'exécute réellement

`scripts/test-sync-api-flutter.mjs` démarre la vraie API compilée avec **creche_app**
en gate strict ; fixtures/inspection via administrateur. Le processus Node reste
asynchrone pendant Flutter : pas de spawnSync qui bloquerait les réponses HTTP.

`apps/staff-mobile/test_live/sync_api_f4_test.dart` utilise :

- vraie authentification HTTP, ApiClient/Dio, client généré, SyncEngine et fichiers
  Drift natifs distincts ; seulement la connectivité déterministe est injectée ;
- création HTTP d'enfant, enregistrement de deux appareils, push de présence par
  le moteur, pull/apparition dans le miroir du second appareil ;
- rejeu de la **même opération stockée** en simulant le redémarrage avant persistance
  de l'ACK local : pas de nouvel event_id, aucune reconstruction de requête en Node ;
- date civile et version réellement utilisables dans le miroir ;
- conflit réel, rejeu stable et absence d'effet métier ;
- fermeture/réouverture du fichier Drift, identité et curseur conservés, autre
  tenant isolé et tentative d'emprunt de l'ancien appareil refusée HTTP 403.

Après les cinq tests, Node vérifie PostgreSQL indépendamment : deux opérations
uniques, un événement de présence, statut/version métier inchangés par conflit,
version originale du conflit = 1, deux appareils malgré le redémarrage.

Ce gate est obligatoire sur GitHub dans le runner existant, après migration/seed
et avant les suites longues. Après F4, reset/migrate/seed avant la batterie historique.
`RUN_SYNC_E2E=1` l'active localement avec Flutter ou `FLUTTER_USE_DOCKER=1`. Sans SDK,
le runner local annonce **F4 non exécuté**, jamais un succès simulé.

Le SDK officiel épinglé (3.47.1/6655482e) et l'image par digest sont partagés avec le
gate F2. Docker monte le checkout read-only, travaille sur une copie éphémère et
utilise le réseau host du runner Linux pour joindre l'API de test en loopback.
Ce n'est pas une URL destinée au navigateur utilisateur. `pub get --enforce-lockfile`
et contrôle du lock avant/après ; pas de SDK ni dépendance supplémentaire committée.

Les identifiants de connexion sont synthétiques/aléatoires, dans un fichier temporaire
0600 supprimé en finally, jamais dans Git ou les arguments de commande. Le rapport
ne contient pas de token. Erreur/timeout/tests rouges font échouer le gate ; annotation
`F4 Flutter API passed` seulement après les assertions PostgreSQL finales.

## Validation, exploitation et limites

Batterie : **36 suites/contrôles**, phase33 (10 contrôles) incluse. Les gates Flutter
F2/F3b et F4 sont distincts ; F1 sérialisation/DTO reste conservé. Consulter le dernier
HEAD/checks de la PR #44 pour les résultats complets acquis. Aucun workflow modifié.

F4 démontre le parcours **enfants/présences** décrit ci-dessus. Il ne démontre pas
encore la projection journal/media, un APK Android release, les permissions mobiles,
la réception réelle de notifications ou une procédure de purge/rétention complète.
Les projections non prises en charge bloquent toujours la page sans avancer son
curseur. L'intégrité composite SQL tenant/device/utilisateur reste à reproduire
séparément. **Ce gate n'autorise donc pas un déploiement global de la sync.**

### Mise à niveau / rollback

Pour un futur déploiement autorisé : maintenance, arrêter les écrivains, sauvegarde
vérifiée si des données existent, appliquer 060 via le migrateur puis les binaires
coordonnés. Toute erreur de migration annule le DDL ; une séquence épuisée exige une
intervention, jamais un retour à zéro automatique. Ne pas purger/resetter les
curseurs ou les files locales pour masquer une divergence historique.

Rollback applicatif : arrêter la sync et conserver 060, le journal et les fichiers
Drift ; ne pas enlever le trigger seul (le default a été retiré). Toute évolution
SQL demande une nouvelle migration. Le binaire précédent réintroduit les défauts
de projection F4 : ne pas l'activer silencieusement en production.
