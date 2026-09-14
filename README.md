# cr-cheDZ — Logiciel de gestion de crèche (Algérie)

Monorepo du SaaS de gestion de crèche : présences offline, journal quotidien, application parents, facturation, conformité loi 25-11 / décret 19-253.

## Stack

| Couche | Technologie |
|---|---|
| Apps mobiles | Flutter 3.x (parents : iOS+Android ; personnel : iOS+Android, offline-first) |
| Admin web + console support | React 18 + TypeScript + Vite |
| Backend | NestJS 10 + TypeScript (monolithe modulaire) |
| Base de données | PostgreSQL 16 (RLS multi-tenant) |
| Stockage médias | MinIO / S3 |
| Jobs | Worker NestJS standalone + `background_jobs` |
| CI/CD | GitHub Actions |
| Contrats API | OpenAPI 3.1 |

## Structure

```
apps/            api (NestJS) · worker · admin-web · parent-mobile · staff-mobile · support-console
packages/        api-contracts · design-system · i18n · shared-config
infrastructure/  docker · database/migrations · nginx · monitoring
docs/            architecture · adr · regulatory · api
tests/           tenant-isolation · sync · financial · e2e
```

## Démarrage rapide (dev)

Prérequis : Docker avec Compose v2. Depuis la racine du monorepo, sur des données
**synthétiques uniquement** :

```bash
# Projet neuf : ne réutilise pas les volumes de l'ancien compose dev.
docker compose -p creche-dev-v2 -f infrastructure/docker/docker-compose.dev.yml up --build
```

Le compose installe avec `npm ci`, initialise les rôles PostgreSQL séparés, applique
migrations/seeds et contrôle le schéma avant de lancer API, worker et web. Ne pas
relancer ces opérations ni une deuxième API sur l'hôte avec les anciennes commandes.
Web : `http://localhost:4000` ; santé API : `http://localhost:3000/api/v1/health`.

Les valeurs `DEV_*` livrées sont strictement locales, jamais des secrets de production.
Les anciens volumes ne sont pas supprimés. Paramètres, preview Arena, rebuild des
packages partagés, redémarrage du worker après édition et arrêt sans destruction :
[runbook H1 dev](docs/PHASE_H1_DEV_RUNBOOK.md).

## Règles non négociables

1. **Fondation d'abord** : JWT tenant → `SET LOCAL app.tenant_id` → test d'isolation vert, avant tout code métier.
2. **Isolation** : toute table avec `organization_id` a RLS `USING` + `WITH CHECK` (voir `tests/tenant-isolation/schema-check.mjs`).
3. **Immuabilité** : une migration appliquée ne se modifie jamais ; une facture payée ne se modifie jamais ; un événement de journal ne se supprime jamais.
4. **Conformité** : loi 18-07 modifiée par la loi 25-11 (pas « RGPD ») ; décret exécutif 19-253.

Détails : [`docs/PLAN_IMPLEMENTATION.md`](docs/PLAN_IMPLEMENTATION.md) · ADR : [`docs/adr/`](docs/adr/)
