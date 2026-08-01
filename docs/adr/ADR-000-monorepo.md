# ADR-000 — Monorepo : pnpm + Turborepo

**Statut** : Accepté (Phase 0)
**Date** : 2026-08-01

## Contexte
Trois applications Node/TS (api, admin-web, support-console) partagent des
configs et des contrats ; deux apps Flutter vivent dans le même dépôt.

## Décision
- Un seul dépôt git, workspaces pnpm (`packages/*`, `apps/*`).
- Turborepo pour la mise en cache des builds.
- Les apps Flutter ne sont PAS dans les workspaces pnpm ; leur CI est
  séparée (workflow Flutter dédié, activé quand les apps sont scaffoldées).

## Conséquences
- `packages/shared-config` : ESLint/Prettier/tsconfig partagés.
- `packages/api-contracts` : spec OpenAPI + types générés.
- Les builds restent rapides grâce au cache Turborepo.

## Alternatives
- Nx (plus lourd, bénéfice marginal à 3 personnes).
- Dépôts séparés (coordination des changements de contrats plus coûteuse).
