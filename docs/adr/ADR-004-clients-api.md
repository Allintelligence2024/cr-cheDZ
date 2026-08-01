# ADR-004 — Clients API : TS généré (web), Dart écrit à la main

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
Le contrat OpenAPI 3.1 est la source de vérité.

## Décision
- **Web (React)** : client TypeScript **généré** (`openapi-typescript`) depuis
  `packages/api-contracts/openapi.yaml`, régénéré à chaque build.
- **Mobile (Dart)** : clients **écrits à la main** et typés (le codegen Dart
  est immature ; la sync offline a des besoins que le codegen ne couvre pas).

## Conséquences
- Toute modification d'endpoint exige la mise à jour de la spec et des
  messages d'erreur FR/AR (règle de livraison).
- Les DTO Dart restent explicites et testables.
