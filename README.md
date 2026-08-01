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

```bash
# 1. Base de données locale (PostgreSQL 16 + MinIO)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# 2. Migrations + seeds
npm run db:migrate
npm run db:seed

# 3. Contrôle du schéma (RLS, contraintes)
npm run db:check-schema

# 4. API
cd apps/api && npm run start:dev
```

## Règles non négociables

1. **Fondation d'abord** : JWT tenant → `SET LOCAL app.tenant_id` → test d'isolation vert, avant tout code métier.
2. **Isolation** : toute table avec `organization_id` a RLS `USING` + `WITH CHECK` (voir `tests/tenant-isolation/schema-check.mjs`).
3. **Immuabilité** : une migration appliquée ne se modifie jamais ; une facture payée ne se modifie jamais ; un événement de journal ne se supprime jamais.
4. **Conformité** : loi 18-07 modifiée par la loi 25-11 (pas « RGPD ») ; décret exécutif 19-253.

Détails : [`docs/PLAN_IMPLEMENTATION.md`](docs/PLAN_IMPLEMENTATION.md) · ADR : [`docs/adr/`](docs/adr/)
