# ADR-007 — Une migration appliquée ne se modifie jamais

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
Les migrations sont des fichiers SQL numérotés.

## Décision
- Toute évolution du schéma = **nouvelle migration numérotée** (015, 016…).
- Le runner enregistre le checksum SHA-256 de chaque fichier et **refuse**
  de rejouer un fichier modifié après application (drift detection).
- `db:check-schema` (CI) vérifie l'absence de dérive dev/staging/prod.

## Conséquences
- Le schéma est reproductible à l'identique sur tous les environnements.
- Les corrections de schéma passent par des migrations correctives.
