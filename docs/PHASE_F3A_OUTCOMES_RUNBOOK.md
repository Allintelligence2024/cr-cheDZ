# F3a — conflits et résultats transactionnels de synchronisation

Date : 2026-09-14. Sous-lot de F3, **pas une clôture de F3/F4**.
Aucun merge ni déploiement. Branche Arena / PR #44.

## Preuves avant correction

Suite `tests/tenant-isolation/phase31-sync-outcomes.api.test.mjs`, vrai serveur
NestJS, PostgreSQL et rôle applicatif NOBYPASSRLS ; fixtures synthétiques.
Le commit de reproduction **5ef2fc6** ne change que les tests.

Sur le code F2 (`f149b55`), **0/15** contrôles passent :

- Une correction à la bonne version est déclarée en conflit parce que la version
  est comparée **après** son incrément.
- Une correction périmée modifie `present/version 1` en `departed/version 2`,
  ajoute un événement de présence et un changelog, puis renvoie un conflit.
- Le rejeu d'un conflit devient `ALREADY_PROCESSED` ; le rejeu d'un rejet perd
  son motif/message initial. Une session absente n'est pas traitée comme version 0.
- Six requêtes bloquées simultanément sur de vrais verrous PostgreSQL ne
  récupèrent pas toutes le même résultat ; concurrence de versions incorrecte.
- Un `event_id` réutilisé avec un autre contenu, appareil ou utilisateur du même
  tenant peut être acquitté comme s'il s'agissait de la première commande.
- Une **vraie erreur au COMMIT** (constraint trigger différé créé/retiré uniquement
  dans le test) laisse un UUID dans `accepted`, avec `INTERNAL_ERROR` en parallèle.
- Une erreur applicative injectée **après** la vraie écriture du journal est
  transformée en rejet, mais ses effets et l'opération sont committés.

Après première correction, les 15 cas passent. Une régression intermédiaire de
comparaison des UUID (casse majuscule autorisée par le contrat) est aussi reproduite :
**17/18**, puis corrigée par comparaison/clé de verrou canoniques. La suite enrichie
est **18/18** : première session concurrente et compatibilité des anciens ACK incluses.
Ce bilan ciblé ne remplace pas le résultat de la batterie/CI du dernier HEAD.

## Correctifs et sémantique

### Contrôle optimiste avant mutation

`AttendanceService.applyCorrection` reçoit une `baseVersion` facultative et compare
la version **verrouillée, avant écriture**. Le verrou de l'enfant est partagé par
tous les chemins de présence HTTP/sync ; il sérialise aussi la création de la
première session, où aucun verrou de ligne de session n'existait encore.

- Version égale : une mutation, un incrément, un événement et un changelog.
- Version différente : `conflicts[{event_id, reason: VERSION_MISMATCH,
  current_version}]`, sans mutation ni effet métier.
- Session absente : version **0**. `base_version: 0` autorise sa création ; une
  autre version entre en conflit sans créer de session.
- Base absente ou `null` : correction sans contrôle optimiste, comme prévu par
  l'enveloppe v1. Aucun changement de règles de date : session du jour à Alger.
- Le contrôle de base_version concerne `correct_attendance`, pas les commandes
  append-only du journal. Ce lot n'ajoute pas de privilège ou de commande.

### Idempotence et résultat durable

Un verrou transactionnel sur `(tenant, event_id canonique)` précède la recherche
et l'insertion. Les retries concurrents attendent puis relisent le résultat committé.
Les accès restent sous RLS, sans pool brut ni fonction SECURITY DEFINER nouvelle.

La migration additive **058_sync_operation_outcome.sql** ajoute `response_outcome`
à `sync_operations`. Le résultat métier (status, reason, message, currentVersion)
est enregistré dans la transaction de la commande et **n'est pas réécrit au rejeu**.
Le `next_cursor` du push reste calculé au moment de la réponse : il peut changer
entre deux réponses ; il ne fait pas partie du résultat mémorisé d'une opération
et ne doit jamais être adopté comme curseur de pull.

- Même appareil/utilisateur et même contenu : même résultat, sans réexécution.
- Contenu différent : `EVENT_ID_REUSED`, sans changer la commande d'origine.
- Autre appareil/utilisateur : `EVENT_ID_OWNERSHIP_MISMATCH`. Une réinstallation
  ne doit pas requalifier/rejouer automatiquement une ancienne file sous un nouvel
  appareil. Le scope persistant F2 conserve l'identité originale.
- Les UUID device/entity sont comparés canoniquement ; l'ordre des clés JSON
  n'est pas une différence de contenu. Le payload métier reste comparé en profondeur.
- Ancien ACK accepté sans résultat JSON : reste accepté. Ancien résultat non
  accepté incomplet : `LEGACY_RESULT_UNAVAILABLE`, vérification manuelle requise.
  **Aucune version historique inventée à partir de l'état courant**, aucune
  réexécution automatique et aucun effacement de file locale.

Les rejets précédant l'enregistrement (appareil invalide, commande inconnue,
version de schéma non supportée, heure invalide/future) ne deviennent pas des
résultats métier persistés. L'autorisation de l'appareil est vérifiée à chaque appel.

### COMMIT et erreurs transitoires

Le service ne publie aucun ACK dans la réponse partagée avant le retour réussi
de `withTenantConnection` (COMMIT effectué). Un échec de commit produit seulement
`INTERNAL_ERROR` pour cette opération ; les autres opérations du lot sont indépendantes.

`INTERNAL_ERROR` retourné par un sous-service provoque le rollback de **toute** la
transaction, même si une exception non SQL survient après une écriture. L'opération
n'est pas persistée comme rejet terminal et reste rejouable. Le moteur F2 conserve
ces opérations dans sa file pending.

## Gate et exploitation

La suite phase31 est incluse dans le runner existant : **34 suites/contrôles**,
avec le reset/migrate/seed prescrit et les rôles/grants de production. Elle ne crée
ni rôle ni grant supplémentaire en mode production. Les seules DDL de faute
injectée sont une fonction/constraint trigger synthétiques et temporaires.

Commandes (cluster dédié `*_test` uniquement) :

```bash
npm ci
npm run typecheck
npm run lint                         # --max-warnings=0 dans le script
npm run test:unit
npm run build
npm audit --omit=dev
ALLOW_DATABASE_RESET=1 DATABASE_URL=... node scripts/test-production-roles.mjs
```

Le runner strict assure lui-même reset, migrations et seeds avant la batterie.
Ne pas lancer les suites isolation/phase3/phase4 sur les résidus d'une suite ciblée.
Pour la preuve finale, consulter le dernier HEAD de la PR #44 : le job `database`
exécute également le gate Flutter F2, le contrat Dart F1 et le gate Docker E2.
Pas de SDK installé/committé localement, pas de workflow ou lockfile modifié.

### Migration et rollback

Installation encore neuve, aucune production à sauvegarder dans cette session.
001–052 et toutes les migrations précédentes restent inchangées ; **055 réservée à G2**.
058 est additive, sans backfill spéculatif. Ordre d'un futur déploiement autorisé :
migration via le migrateur, puis API ; ne pas lancer la nouvelle API sans 058.

Rollback applicatif : arrêter la synchronisation et revenir au binaire précédent
uniquement en environnement contrôlé. **Ne pas réactiver ses corrections offline
buguées en production.** Conserver 058 et les résultats déjà écrits (l'ancien code
ignore la colonne), tous les événements et fichiers Drift. Ne pas supprimer la
colonne pour revenir en arrière ; si une évolution SQL est nécessaire, écrire une
migration supplémentaire. Les conflits historiques ne peuvent pas être reconstruits
sans intervention et les effets déjà committés par l'ancien code ne sont pas annulés
automatiquement. Aucune réparation de données réelles n'est exécutée ici.

## Reste de F3 / F4

- Producteurs child, projection minimale, bootstrap, tous les chemins et tombstones.
- Projections journal/media côté Drift : un type non pris en charge bloque encore
  la page sans avancer le curseur.
- Pagination sûre en ordre de commit : BIGSERIAL seul reste insuffisant ; reproduire
  A lente/B rapide avant de choisir la correction.
- Intégrité composite SQL des références de sync : reproduire avant modification.
- F4 : vrai client Dart contre vraie API, deux appareils, reprise et conflit.

**Ce sous-lot ne rend donc pas encore la synchronisation complète déployable.**
