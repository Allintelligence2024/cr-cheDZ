# ADR-006 — Accès DB en `pg` brut, jamais d'ORM

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
La Partie 6 de l'architecture importait TypeORM dans les tests alors que le
code applicatif utilise `pg` — incohérent et non exécutable.

## Décision
- Toute la pile (API, worker, tests) utilise **`pg`** (client PostgreSQL) et
  le contexte tenant `SET LOCAL` (TenantContextService).
- Pas d'ORM. Si le besoin de requêtes typées se fait sentir, évaluer Kysely
  (surcouche légère, sans mapping objet) — jamais TypeORM.

## Conséquences
- Les tests d'isolation s'exécutent contre une vraie base PostgreSQL (CI :
  service container `postgres:16`).
- Les requêtes RLS restent transparentes et maîtrisées.
