# ADR-002 — DZD seul pour le MVP

**Statut** : Accepté (MVP)
**Date** : 2026-08-01

## Contexte
La colonne `currency` existe partout dans le schéma de facturation.

## Décision
Le MVP facture **exclusivement en DZD** (`currency` figée à `'DZD'`).
La multi-devise est hors périmètre v1 ; les colonnes existent déjà, aucune
migration ne sera nécessaire pour l'activer.

## Conséquences
- Pas de taux de change, pas de formats multi-devises dans l'UI.
- Les exports et PDF sont en DZD (format algérien).
