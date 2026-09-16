# ADR-004 — Clients API : TS généré (web), Dart écrit à la main

**Statut** : Accepté — **implémenté partiellement** (revue de claims 2026-09,
PR #45 : l'état réel est décrit ci-dessous ; ne pas relire « à chaque build »)
**Date** : 2026-08-01 (révisé 2026-09-15)

## Contexte
Le contrat OpenAPI 3.1 (`packages/api-contracts/openapi.yaml`) est la source
de vérité **des 13 paths qu'il couvre** (auth, devices, me, rooms, health) ; il
n'est PAS généré depuis le code et ne couvre pas les ~172 routes réelles. Le
contrat de sync mobile est un artefact distinct et complet pour son périmètre
([`sync-contract.md`](../architecture/sync-contract.md), F1).

## Décision
- **Web (React)** : un générateur de types (`openapi-typescript`) est configuré
  et **fonctionne à la demande** (`npm run generate --workspace
  @creche/api-contracts` → `dist/client.d.ts`, ignoré par Git). Il n'est PAS
  branché au build, et le client web actuel (`src/api/client.ts`) reste écrit
  à la main sans consommer ces types — l'affirmation historique « régénéré à
  chaque build » était fausse et a été corrigée plutôt qu'implémentée sans
  décision.
- **Mobile (Dart)** : clients **écrits à la main** et typés (le codegen Dart
  est immature ; la sync offline a des besoins que le codegen ne couvre pas).

## Conséquences
- Toute modification d'endpoint **des 13 paths couverts** exige la mise à jour
  de la spec et des messages d'erreur FR/AR ; l'extension de la couverture est
  une tâche à décider, pas une promesse tenue.
- Les DTO Dart restent explicites et testables.
