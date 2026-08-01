# ADR-008 — Curseur de synchronisation = séquence, pas horloge

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
La doc d'origine utilisait `EXTRACT(EPOCH FROM server_time) * 1000` comme
curseur : deux événements dans la même milliseconde ou une correction
d'horloge font perdre ou dupliquer des événements.

## Décision
- Table `sync_changelog` avec `sync_seq BIGSERIAL` : **toute** écriture métier
  (présence, journal, média, enfant…) insère une ligne **dans la même
  transaction**.
- `pull(cursor)` lit `WHERE organization_id = $1 AND sync_seq > $2
  ORDER BY sync_seq LIMIT 500` ; `next_cursor = max(sync_seq)`.
- Le curseur est stocké côté serveur (`sync_cursors`) ; l'appareil le
  mémorise mais le serveur fait autorité.

## Conséquences
- Couvre tous les types d'entités (pas seulement présence/journal).
- Idempotence et reprise garanties sans dépendre des horloges.
