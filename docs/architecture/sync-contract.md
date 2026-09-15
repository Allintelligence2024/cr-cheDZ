# Contrat de transport sync v1 — F1

Date : 2026-09-14. **Artefact livré, pas une déclaration de sync Flutter fonctionnelle.**
Le contrat décrit les enveloppes réseau et les quatre projections actuellement produites ; ordre de publication F3c et gate réel F4 documentés ci-dessous. Android release et les détails/pièces jointes hors ligne ne sont pas qualifiés.
Le stockage Drift et le raccordement au moteur sont livrés en F2, voir
[runbook F2](../PHASE_F2_CLIENT_RUNBOOK.md).

## Sources de vérité et génération

- `packages/sync-contract/sync.schema.json` : JSON Schema draft-07, requêtes et réponses.
- `packages/sync-contract/protocol.json` : version, routes, maximum du curseur int64.
- `packages/sync-contract/conformance.json` : corpus commun positif/négatif.
- `scripts/generate-sync-contract.mjs` : génération déterministe, sans dépendance réseau.
- `apps/api/src/modules/sync/generated/sync-contract.ts` : validateur du curseur
  utilisé **dans le DTO API**, pas seulement dans les tests.
- `apps/staff-mobile/lib/core/network/generated/sync_wire_client.dart` :
  **client réseau Dart généré**, validation avant envoi et après réponse.

```bash
node scripts/generate-sync-contract.mjs          # après changement du contrat/template
node scripts/generate-sync-contract.mjs --check  # CI : aucune dérive autorisée
npm run build --workspace @creche/api
node scripts/check-sync-contract.mjs             # Dart installé, ou SYNC_USE_DOCKER=1
node scripts/check-sync-contract.mjs --node-only # LOCAL seulement : ne valide PAS Dart
```

Le générateur refuse un mot-clé/type/format non pris en charge par son validateur
Dart. Le schéma est vérifié aussi par AJV (outillage déjà verrouillé dans le
lockfile) et les **vrais DTO class-validator/class-transformer**. AJV n'est pas
ajouté aux dépendances de production. Les artefacts générés sont versionnés ; aucun
SDK, lockfile npm modifié ou dépendance nouvelle n'est nécessaire.

Le gate GitHub, appelé par `test-production-roles.mjs` sans modifier les workflows,
exécute le Dart avec `dart:3.9.4-sdk`, montage source **lecture seule**, réseau du
conteneur désactivé et aucune dépendance pub. Il capture six requêtes réellement
sérialisées par `SyncWireClient`, puis les valide contre schéma **et DTO TS**.
Le corpus commun et le refus d'une réponse à curseur numérique sont exécutés en Dart.
Les erreurs du transport sont propagées sans retry automatique.

**Limite :** le transport de ce test est un enregistreur. Il ne contacte pas l'API.
Le client généré est désormais branché dans `SyncEngine` (F2), avec un gate Flutter/Drift distinct.
Ce gate est F1, **pas F4**. Les résultats d'exécution CI sont ceux de la
[PR #44](https://github.com/Allintelligence2024/cr-cheDZ/pull/44).

## Version et compatibilité

`v1` est la première version formalisée de cet artefact, distincte du champ
`schema_version` des opérations. Il n'y a **pas de négociation de version HTTP**.

**Changement de type incompatible** avec un ancien client qui castait `next_cursor`
en `int` : le serveur le renvoie désormais toujours en chaîne. L'ancien client
était déjà en échec sur les pages non vides et n'envoyait pas le device obligatoire
(F0). L'installation a été déclarée neuve, sans production par le client ; cette
PR n'est néanmoins **pas à déployer avant la fin F3–F4**. Ne pas inventer de fallback vers
un Number/int32 ni prétendre à une compatibilité mobile déjà testée.

## Authentification et appareil

Base : `/api/v1`, bearer access token. `/sync/push` et `/sync/pull` restent limités
à `super_admin`, `director`, `educator`, `receptionist`. Les parents utilisent leurs
API dédiées : ce contrat n'élargit aucun rôle.

`POST /devices` → **201**, `RegisterRequest` → `RegisterResponse` :

```json
{"name":"Tablette accueil","device_fingerprint":"installation-uuid-persisté","platform":"android","app_version":"1.0.0"}
```

Réponse : `{"device_id":"UUID-serveur"}`, **pas** `{id}`.
- `name` : chaîne de 2 à 120 caractères ; fingerprint : chaîne ≥8.
- `platform` : `android`, `ios`, `web`.
- `app_version`, `fcm_token`, `apns_token` : chaînes optionnelles/nullable comme les DTO.
- F2 : enregistrement idempotent via verrou transactionnel par scope
  `(organization_id, user_id, fingerprint)` ; le client persiste son fingerprint
  avant le POST, conserve le device_id et ne réinscrit pas à chaque poll.
- Appareil révoqué/inactif : 403 DEVICE_REVOKED ; doublons historiques ambigus :
  409 DEVICE_REGISTRATION_AMBIGUOUS. Jamais de réactivation ou fusion automatique.
- Le serveur exige maintenant l'appareil actif **du tenant ET de l'utilisateur**
  authentifié. Révocation self-service : propriétaire uniquement, sinon 404.
- Détails et limites (SQL direct, métadonnées, migration locale) dans le runbook F2.

## Push

`POST /sync/push` → **200**, `PushRequest` → `PushResponse`.

```json
{
  "device_id":"11111111-1111-4111-8111-111111111111",
  "operations":[{
    "event_id":"22222222-2222-4222-8222-222222222222",
    "client_sequence":1,
    "schema_version":1,
    "command":"check_in",
    "entity_type":"attendance",
    "payload":{"child_id":"33333333-3333-4333-8333-333333333333"},
    "occurred_at_device":"2026-09-14T08:00:00Z"
  }]
}
```

- `client_sequence`, `schema_version` : nombres JSON entiers ≥1.
- `entity_id` : UUID optionnel/nullable ; `base_version` : entier optionnel/nullable.
- `payload` : objet ; ses champs dépendent de la commande. Ce schéma **d'enveloppe**
  ne remplace pas les validations métier. `occurred_at_device` est une chaîne,
  interprétée par le service (date invalide/futur → rejet par opération).
- Les propriétés supplémentaires sont refusées, sauf dans `payload`.
- Le lot est parcouru dans l'ordre fourni, **une transaction par opération**, pas
  de transaction globale. `event_id` est la clé d'idempotence ; `client_sequence`
  n'est ni un curseur serveur ni un acquittement. Sa persistance locale est livrée en F2.
- Commandes connues : `check_in`, `check_out`, `mark_absent`, `log_meal`,
  `log_nap_start`, `log_nap_end`, `log_diaper`, `log_activity`, `log_temperature`,
  `log_note`, `add_photo`, `log_incident`, `correct_attendance`.
  Une commande inconnue reste un rejet `UNKNOWN_COMMAND`, pas un 400 de schéma.
  `schema_version > 1` → `UNSUPPORTED_SCHEMA_VERSION`.

Réponse obligatoire, même avec un lot vide :

```json
{"accepted":[],"rejected":[],"conflicts":[],"next_cursor":"0"}
```

- `accepted` : tableau d'UUID event_id.
- `rejected` : `{event_id: UUID, reason: string, message: string}`.
- `conflicts` : `{event_id: UUID, reason: string, current_version: integer}`.
- Autres motifs existants : `DEVICE_REVOKED`, `EVENT_ID_REUSED`,
  `EVENT_ID_OWNERSHIP_MISMATCH`, `LEGACY_RESULT_UNAVAILABLE`,
  `INVALID_DEVICE_TIME`, `DEVICE_TIME_AHEAD`, `INTERNAL_ERROR`, et ceux des services métier.
- Ne jamais acquitter une opération absente des trois tableaux. `INTERNAL_ERROR`
  n'est pas une preuve de rejet définitif. F2 conserve les opérations absentes/INTERNAL_ERROR et bloque les ACK incohérents.
- **F3a** : `correct_attendance` compare `base_version` avant mutation sur la
  session verrouillée (session absente = version 0, base absente/null = sans CAS).
  Un conflit ne modifie ni état ni événements/changelog. Le résultat est persisté
  avec la commande (migration 058) et rejoué sans le recalculer après d'autres écritures.
- Le verrou `(tenant, event_id)` sérialise les retries. Appareil/utilisateur et
  contenu d'origine doivent être identiques ; sinon rejet explicite, sans effet.
  UUID device/entity canoniques, comparaison profonde du payload.
- L'ACK n'est publié qu'après COMMIT. Une erreur transitoire annule opération et
  effets et laisse la commande rejouable. Le `next_cursor` du push peut évoluer
  au rejeu : seul le résultat de l'opération est mémorisé, jamais le curseur global.
- Ancien résultat non accepté sans détail durable : `LEGACY_RESULT_UNAVAILABLE`,
  vérification manuelle, aucune version historique inventée ni réexécution automatique.
  Les anciens ACK acceptés restent reconnus. Preuves : [runbook F3a](../PHASE_F3A_OUTCOMES_RUNBOOK.md).
- F4 exécute désormais le vrai moteur Flutter/Drift contre l'API (voir runbook),
  sur les quatre types produits, y compris les métadonnées journal/médias.
  Les détails de dossiers/pièces jointes hors ligne ne font pas partie de ce contrat.

## Pull et curseur int64

`GET /sync/pull?device_id=UUID&cursor=0` → **200**, `PullQuery` → `PullResponse`.

```json
{
  "events":[{"sync_seq":"9007199254740993","type":"attendance",
    "aggregate_id":"33333333-3333-4333-8333-333333333333",
    "event_type":"check_in","payload":{},"created_at":"2026-09-14T08:00:00Z"}],
  "next_cursor":"9007199254740993"
}
```

**Tous** les `sync_seq` et `next_cursor` sont des chaînes décimales canoniques de
`"0"` à `"9223372036854775807"`. Le format partagé `sync-cursor` vérifie aussi la borne
SQL, que `pattern` seul ne peut pas exprimer. Pas de signe, espace, zéro initial,
notation exponentielle, décimale ni conversion par Number. Un curseur invalide
est un **400**, pas une erreur SQL 500. Les valeurs HTTP query sont textuelles.

- Tri SQL `sync_seq` croissant ; maximum 500 événements/page.
- Page non vide : curseur du dernier événement. Page vide : renvoie exactement
  le curseur reçu, **toujours chaîne**. Initialiser à `"0"`.
- Répéter le dernier curseur n'inclut pas à nouveau les événements déjà lus.
- `sync_cursors` conserve la dernière valeur servie ; ce n'est **pas une preuve
  d'application/acquittement du miroir local**. Le client reste responsable de
  conserver sa page et son curseur dans une même transaction Drift (livré F2).
- Le `next_cursor` d'un **push ne doit jamais remplacer le curseur de pull**.
- **F3c / migration 060** : le scénario A lente/B rapide a reproduit le saut de A.
  Le default BIGSERIAL est retiré : un trigger prend un verrou par tenant avant
  nextval, conservé jusqu'au COMMIT/ROLLBACK. Les lecteurs voient un préfixe committé.
  L'application ne peut ni fournir une séquence ni modifier/supprimer une publication.
  Les trous après rollback/autres tenants sont normaux ; le curseur reste opaque.
- Les écritures explicites d'un opérateur BYPASSRLS demandent une maintenance et une
  reprise contrôlée. Pas de réparation automatique d'un curseur déjà avancé avant 060.
  Détails/limites : [runbook F3c/F4](../PHASE_F3C_F4_RUNBOOK.md).

## Erreurs HTTP

Enveloppe `ErrorResponse` : `statusCode` (integer), `code`, `message_fr`,
`message_ar`, `timestamp`, `path` (strings), `correlation_id` optionnel,
`details` optionnel (contenu libre, notamment tableau des erreurs DTO).

| HTTP | Signification et traitement cible |
|---|---|
| 400 `BAD_REQUEST` | Enveloppe/device/curseur invalide ; afficher un défaut de contrat, pas de boucle de retry aveugle |
| 401 | Session absente/expirée ; refresh contrôlé puis réauthentification si échec |
| 403 `DEVICE_REVOKED` au pull | Appareil révoqué/inconnu dans ce tenant ; arrêter la sync, pas de réinscription automatique |
| 403 `FORBIDDEN` | Rôle/périmètre interdit ; ne pas tenter un autre tenant implicitement |
| 429 | Limitation ; respecter une temporisation, en particulier `/devices` |
| 5xx / réseau | État potentiellement ambigu ; conserver event_id et opérations pour reprise |

Le push conserve les rejets d'appareil par opération ; **un push vide n'est pas
un test d'autorisation de l'appareil**. Le transport Dart doit lever une exception
sur non-2xx ; le client généré la propage sans la transformer en succès.

## État des autres travaux F

**F3b enfants** : `created/updated/snapshot` transportent une projection explicite
à 13 champs ; `deleted` contient seulement id/tenant/version/deleted_at. Producteur
SQL transactionnel pour tous les écrivains, bootstrap initial en migration 059,
consommation Drift atomique avec le curseur, sans effacer la file d'opérations.
Voir [runbook F3b](../PHASE_F3B_CHILDREN_RUNBOOK.md) pour la liste des champs et les
preuves. Aucun `to_jsonb(children)`, dossier médical, contact ou note interne
ajouté au changelog. Les métadonnées journal/media sont maintenant projetées (voir ci-dessous).

Les FK simples de 006 sont complétées par **061** : membership du propriétaire du
device, opération/device/propriétaire, curseur/device/tenant et origine du changelog.
Contraintes pleinement validées, sans cascade ; des incohérences anciennes font
échouer la migration au lieu de réattribuer un historique. 001–060 inchangées,
055 réservée à G. Préflight et rollback dans le runbook F/H1.

**Preuves locales :** phase29 = 26/26 après correction (première reproduction :
5/23 avant), corpus schéma/DTO = 49/49. Le diagnostic historique F0 est conservé
avec sa fixture, mais retiré du runner : ne pas exiger que les anciens défauts
restent présents. Sa couverture API positive (push/pull/deux devices/idempotence)
est reprise dans phase29. Le gate F4 réel des quatre types produits est obligatoire ; Android release reste distinct.


La première correction a également exposé une régression : `ORDER BY sync_seq`
résolvait l'alias de projection texte et triait lexicalement. Le stress phase5
l'a détectée ; un nouveau test dédié était rouge (**25/26**) avant de qualifier
`ORDER BY sync_changelog.sync_seq` (tri BIGINT), puis vert (**26/26**).
Cette correction de tri ne résout **pas** le risque d'ordre de commit cité plus haut.


### Projection présence et gate F4

Les nouvelles publications `attendance` contiennent une `session_date` DATE texte
à Alger et la `version` résultant de la commande, lues dans sa transaction. Drift
conserve la version au lieu de laisser zéro. Les anciens événements ne sont pas
backfillés en inventant une version historique à partir de l'état courant.
Le gate `scripts/test-sync-api-flutter.mjs` exécute sept tests du vrai moteur,
puis vérifie les opérations, événements, sessions et appareils dans PostgreSQL.


### Projections journal/médias (F clôture fonctionnelle)

- `daily_log` : ID canonique = `aggregate_id`, payload `{child_id, event_type,
  event_date, occurred_at}` ; DATE stricte, type concordant avec l'enveloppe. Les
  neuf types JournalService sont pris en charge. Stockage `LocalDailyEvents`,
  `is_synced=true`, métadonnées explicitement filtrées ; pas de texte de dossier.
- `media` / `media_registered` : `media_id` doit correspondre à `aggregate_id`,
  `child_id` UUID ou null, `media_type` photo/document. Drift v3 `local_media`
  conserve ces métadonnées, le tenant de la base scopée et `created_at` serveur.
  Aucune clé S3, URL signée, visibilité/permission ou pièce jointe mise en cache.
- Les détails et téléchargements restent en ligne, avec autorisation via les
  endpoints existants. Les nouvelles projections n'élargissent pas les données
  sensibles accessibles hors ligne. La matrice complète reste le chantier H2.
- Toute erreur d'identité/type/date fait annuler tous les miroirs de la page et
  le curseur ; file et historique d'opérations jamais supprimés. Le fichier v2
  scopé est migré en v3 sur place, pas renommé ni abandonné.

[Reproductions, frontière fonctionnelle, upgrade et rollback](../PHASE_F_COMPLETION_H1_RUNBOOK.md).
