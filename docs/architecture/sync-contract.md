# Contrat sync — F1, brouillon non implémenté

Statut : **proposition**, 2026-09-14. Voir le diagnostic F0 pour les réponses
actuelles (types de curseur instables). Ce fichier n'est pas une spécification
générée ni un contrat déjà validé des deux côtés.

## Auth et scope

Routes staff uniquement, bearer access token et tenant validé par l'API.
Le miroir, le device_id, la file et le curseur doivent appartenir au même scope
`(organization_id, user_id, installation)`. Aucun partage implicite à travers
un changement de compte ou d'organisation. Les parents restent sur leurs API.

## Enregistrement existant

```json
{"name":"Tablette accueil","device_fingerprint":"UUID-installation-persisté","platform":"android","app_version":"1.0.0"}
```

`POST /devices` → HTTP 201, `{"device_id":"UUID-serveur"}`. Ce protocole existe,
mais sa reprise après timeout réseau et la récupération d'un device existant
restent à définir avant l'implémentation client (ne pas créer à chaque poll).

## Push proposé

```json
{
  "device_id":"UUID",
  "operations":[{
    "event_id":"UUID-stable-au-rejeu",
    "client_sequence":1,
    "schema_version":1,
    "command":"check_in",
    "entity_type":"attendance",
    "payload":{"child_id":"UUID","site_id":"UUID"},
    "occurred_at_device":"2026-09-14T08:00:00Z"
  }]
}
```

Commandes et motifs par opération restent ceux de `SyncOperationDto` et du
service. Ne pas acquitter localement une opération non mentionnée dans le
résultat. Distinguer erreur de transport/401/400 de rejet métier permanent.
Après 401 non récupéré, arrêter le retry aveugle et demander une session valide.
`event_id` sert à la déduplication ; la séquence locale est persistée.

## Curseurs proposés

**Proposition : chaîne décimale opaque**, de `"0"` à `"9223372036854775807"`,
sans float JS ni cast SQL int32. Même type en push, pull vide et pull non vide.
Ancien contrat : query transformée en Number ; push number, pull number/string.
Une stratégie de version/compatibilité est nécessaire avant de le changer.

`GET /sync/pull?device_id=UUID&cursor=0` → forme cible :

```json
{
  "events":[{
    "sync_seq":"123",
    "type":"attendance",
    "aggregate_id":"UUID",
    "event_type":"check_in",
    "payload":{},
    "created_at":"2026-09-14T08:00:00Z"
  }],
  "next_cursor":"123"
}
```

Le `next_cursor` du push n'est **pas** un acquittement de pull. Une page et son
curseur sont appliqués dans la même transaction locale. Le client pagine jusqu'à
épuisement, sans avancer devant un événement non reconnu/non applicable.
Ne pas utiliser le dernier ID réservé comme watermark de commits : le cas
transactions concurrentes doit être testé avant de garantir une pagination sûre.

## Projection child à définir

Projection explicitement limitée aux champs nécessaires au miroir autorisé,
avec `organization_id`, version et identifiants ; pas de dossier médical complet,
contacts, documents ou notes internes dans un JSON `to_jsonb(children)`.
Définir création, modification, déplacement, départ et suppression, ainsi que
le bootstrap des enfants existants. Un événement `child` doit permettre une
mise à jour locale atomique ; une suppression doit avoir un tombstone exploitable.

## Livrables encore attendus

- Schéma JSON versionné `packages/sync-contract/` et validation API/Dart.
- Fixtures réellement émises par le client Dart (pas reconstituées à la main).
- Tests de reprise, événements tardifs, doublons, conflits et isolation de scope.
- Gate F4 exécuté ; aucune revendication de sync fonctionnelle à ce stade.
