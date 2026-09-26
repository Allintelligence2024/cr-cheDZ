# cr-cheDZ — Logiciel de gestion de crèche (Algérie)

Monorepo du SaaS de gestion de crèche : présences offline, journal quotidien, application parents, facturation, conformité loi 25-11 / décret 19-253.

## Stack

| Couche | Technologie |
|---|---|
| Apps mobiles | Flutter 3.x (parents : iOS+Android ; personnel : iOS+Android, offline-first) |
| Admin web + console support | React 19 + TypeScript + Vite |
| Backend | NestJS 11 + TypeScript (monolithe modulaire) |
| Base de données | PostgreSQL 18 (RLS multi-tenant — validé sur PG 18 réel, JAMAIS 16/17 : cf. en-tête `ci.yml`) |
| Stockage médias | MinIO / S3 |
| Jobs | Worker NestJS standalone + `background_jobs` |
| CI/CD | GitHub Actions |
| Contrats API | OpenAPI 3.1 **partiel** : spec écrite à la main (13 paths, auth/devices/me/rooms/health), types web générables `npm run generate` — non branchés au build. Contrat de sync : `docs/architecture/sync-contract.md` |

## Structure

```
apps/            api (NestJS) · worker · admin-web · parent-mobile · staff-mobile · support-console
packages/        api-contracts · design-system · i18n · shared-config
infrastructure/  docker · database/migrations · nginx · monitoring
docs/            architecture · adr · regulatory · api
tests/           tenant-isolation · sync · financial · e2e
```

## Démarrage rapide (dev)

Prérequis :
- **Docker** avec Compose v2 — la stack dev s'exécute entièrement en conteneurs
  (aucun `node_modules` requis sur l'hôte) ;
- **Node ≥ 20** uniquement pour les scripts exécutés sur l'hôte (migrations
  standalone, seeds, suites de tests — `engines` du manifeste racine) ;
- **Flutter 3.47.1** seulement pour développer ou bâtir les apps mobiles ;
- **k6** optionnel — non exécuté ici, binaire absent (`tests/load/sync.k6.js`, à lancer depuis
  un poste qui a k6) : le test de charge **exécuté** par le dépôt est `npm run test:capacity`
  (`tests/load/capacity-bench.mjs`, sans k6).

Depuis la racine du monorepo, sur des données **synthétiques uniquement** :

```bash
# Projet neuf : ne réutilise pas les volumes de l'ancien compose dev.
# (R1 PG16→18 : un volume formatté PostgreSQL 16 n'est PAS lisible par 18 —
#  nouveau nom de projet, cf. BACKUP-RUNBOOK « Upgrade PostgreSQL 16 → 18 ».)
docker compose -p creche-dev-v3 -f infrastructure/docker/docker-compose.dev.yml up --build
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
