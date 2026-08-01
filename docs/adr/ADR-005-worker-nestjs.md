# ADR-005 — Worker = application NestJS standalone

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
Le doc d'architecture montrait un worker en script brut (`apps/worker/src/worker.ts`).

## Décision
Le worker est une **application NestJS standalone**
(`NestFactory.createApplicationContext`) qui réutilise les modules métier
(jobs, notifications, billing, media) sans serveur HTTP.

## Conséquences
- Réutilisation des services et des guards de validation.
- Métriques Prometheus sur un petit endpoint HTTP séparé (port 3001).
- Consommation de `background_jobs` via `FOR UPDATE SKIP LOCKED` (idempotent
  multi-instance).
