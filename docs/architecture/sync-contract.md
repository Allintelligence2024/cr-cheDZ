# Contrat de transport sync v1 — F1

Date : 2026-09-14. **Artefact livré, pas une déclaration de sync Flutter fonctionnelle.**
Le contrat décrit les enveloppes réseau ; les projections métier, la garantie de pagination sous transactions concurrentes restent F3.
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
- Autres motifs existants : `DEVICE_REVOKED`, `ALREADY_PROCESSED`,
  `INVALID_DEVICE_TIME`, `DEVICE_TIME_AHEAD`, `INTERNAL_ERROR`, et ceux des services métier.
- Ne jamais acquitter une opération absente des trois tableaux. `INTERNAL_ERROR`
  n'est pas une preuve de rejet définitif. F2 conserve les opérations absentes/INTERNAL_ERROR et bloque les ACK incohérents.
- La forme `conflicts` est contractualisée, mais **ni l'absence d'effet d'un conflit
  ni la stabilité de sa réponse au rejeu ne sont démontrées** : à tester/corriger en F3/F4.

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
- **Réserve critique F3 : BIGSERIAL n'est pas un ordre de commit.** Un écrivain A
  lent peut réserver un ID inférieur à celui de B déjà committé. Cette correction
  de type n'empêche pas de sauter A après avoir lu B. Aucune garantie de livraison
  complète/concurrente tant que le scénario n'est pas reproduit puis corrigé.

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

Les événements `child` manquent encore. Projection minimale explicite, bootstrap,
tombstones et tous les chemins d'écriture restent F3 ; jamais de `to_jsonb(children)`
ni de dossier médical/contacts/notes internes dans le changelog par commodité.

Les FK `sync_operations.device_id` et `sync_cursors.device_id` existent déjà depuis
006 ; cela ne prouve pas l'intégrité composite tenant/device/utilisateur. Pas de
migration SQL nouvelle dans ce lot (001–052 inchangées, 055 réservée à G).

**Preuves locales :** phase29 = 26/26 après correction (première reproduction :
5/23 avant), corpus schéma/DTO = 49/49. Le diagnostic historique F0 est conservé
avec sa fixture, mais retiré du runner : ne pas exiger que les anciens défauts
restent présents. Sa couverture API positive (push/pull/deux devices/idempotence)
est reprise dans phase29. Le gate F4 complet reste ouvert.


La première correction a également exposé une régression : `ORDER BY sync_seq`
résolvait l'alias de projection texte et triait lexicalement. Le stress phase5
l'a détectée ; un nouveau test dédié était rouge (**25/26**) avant de qualifier
`ORDER BY sync_changelog.sync_seq` (tri BIGINT), puis vert (**26/26**).
Cette correction de tri ne résout **pas** le risque d'ordre de commit cité plus haut.
