# LOCAL-RUN — Environnement local fonctionnel (remédiation R4, 2026-09-21)

Objectif : clone frais → environnement testable en < 30 min (porte G-local).
**Données synthétiques uniquement** : le seed pilote se déclare « exclusif
synthétique » — jamais de données réelles d'enfants sur un environnement local.

Deux voies : **A** (Docker — voie officielle, README/H1) et **B** (hôte sans
Docker — voie de gate des tests, PostgreSQL embarqué).

---

## Voie A — Docker (recommandée)

Prérequis : Docker avec Compose v2. Rien d'autre sur l'hôte pour la stack
(le build des images fait le `npm ci` du monorepo) ; Node ≥ 20 seulement pour
le seed pilote et les suites de tests hôte.

```bash
# 1. Stack complète :
#    postgres 18 → minio → bootstrap-roles (creche_migrator / creche_app)
#    → migrate (75 migrations + seeds + schema-check) → api + worker + admin-web
#    -p creche-dev-v3 = PROJET NEUF : un volume formatté PostgreSQL 16 n'est
#    PAS lisible par PG18 (BACKUP-RUNBOOK « Upgrade PostgreSQL 16 → 18 »).
docker compose -p creche-dev-v3 -f infrastructure/docker/docker-compose.dev.yml up --build

# 2. Données de démo : 5 crèches pilotes SYNTHÉTIQUES (organisation, sites,
#    3 salles, directrice + 2 éducatrices, 15 enfants, gardiens, contrats).
npm ci
docker compose -p creche-dev-v3 -f infrastructure/docker/docker-compose.dev.yml run --rm \
  -e PILOT_PASSWORD='motdepasse_local_test' api \
  node scripts/pilot/seed-pilot.mjs 01 02 03 04 05
```

Accès :

| Service | URL |
|---|---|
| Admin web | `http://localhost:4000` (proxy `/api` → `api:3000`) |
| Santé API | `http://localhost:3000/api/v1/health` |
| Sonde conteneur API | `docker compose … exec api node apps/api/dist/healthcheck.js` (identique au `HEALTHCHECK`) |
| Sonde conteneur worker | `docker compose … exec worker node apps/worker/dist/healthcheck.js` (marqueur de vivacité) |
| MinIO API / console (dev) | `http://127.0.0.1:9000` / `http://127.0.0.1:9001` |

Comptes de test : `docs/pilot/ONBOARDING.md` (mot de passe = `PILOT_PASSWORD`).

### Scripts hôte contre la stack Docker

Le compose expose PostgreSQL sur `127.0.0.1:5432` (`creche_app` /
`dev_app_only_change_me` / `creche_dev`) :

```bash
export DATABASE_URL=postgresql://creche_app:dev_app_only_change_me@127.0.0.1:5432/creche_dev
node tests/tenant-isolation/schema-check.mjs --verbose
node tests/tenant-isolation/rls-behavior-check.mjs     # GATE RLS
bash scripts/run-isolation-suites.sh                    # 29+ suites API (api+worker compilés)
```

---

## Voie B — Hôte, sans Docker (gate de validation)

C'est la voie validée par le runbook D et rejouée par la CI (`database`,
`postgres:18`). PostgreSQL 18 embarqué (paquet `embedded-postgres`, données
purgeables dans `/tmp/pgtest`) :

```bash
npm ci                                  # Node ≥ 20 (engines du manifeste racine)
node run_pg.mjs &                       # PG 18.4 — port 54329, base creche_test
export DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test

node scripts/migrate.mjs                # 75 migrations (checksums SHA-256, ADR-007)
node scripts/seed.mjs                   # rôles/permissions système — AUCUNE donnée d'org
node tests/tenant-isolation/schema-check.mjs
node tests/tenant-isolation/rls-behavior-check.mjs    # GATE RLS (rôle NOBYPASSRLS)

# Smoke HTTP de l'API (optionnel) :
npm run build --workspace @creche/api
NODE_ENV=development STORAGE_BACKEND=local STORAGE_LOCAL_DIR=/tmp/creche-local-pdf \
EMAIL_PROVIDER=none node apps/api/dist/main.js
curl -s http://localhost:3000/api/v1/health
```

---

## Reset / nettoyage

```bash
# Docker : détruit les volumes du projet (destructif)
docker compose -p creche-dev-v3 -f infrastructure/docker/docker-compose.dev.yml down -v

# Hôte : arrêter run_pg.mjs (SIGTERM), puis
rm -rf /tmp/pgtest                      # recréé par initialise() au prochain run

# Base hôte : migrations + seeds depuis zéro
npm run db:reset                        # migrate --reset && migrate && seed
```

## Checklist d'acceptation G-local (porte Phase 1)

- [ ] `git log` ≥ 2 commits (baseline remédiation)
- [ ] PG18 : 75 migrations + `db:check-schema` + `db:check-rls` verts sur base neuve
- [ ] `up --build` : tous les services up (bootstrap-roles, migrate, api, worker, admin-web, minio)
- [ ] seeds + 5 crèches pilotes ; login **directrice pilot-01** sur `:4000`
- [ ] Smoke : 1 pointage arrivée/départ, 1 entrée journal, 1 photo (MinIO), 1 export PDF (worker)
- [ ] staff-mobile : login + 1 round-trip sync
- [ ] `.env` dérivé de `.env.prod.example` rempli → garde production `validateProductionConfig` verte (R2)
- [ ] Aucun service sur `0.0.0.0` hors nginx sur la cible (R3)

## Les deux modes d'exécution des suites (à retenir)

1. **Mode canon local** : `bash scripts/run-isolation-suites.sh` (base jetable
   `*_test`, rôles de test `creche_app_test`). Résultat du 2026-09-21 :
   **62/65** — les 3 échecs (phase22/47/49, checks « boots against actual
   application role ») sont **par conception** : en mode normal, `appUrl()`
   renvoie `creche_app_test` alors que la garde `DATABASE_ROLE_UNSAFE` exige
   exactement `creche_app` sous `NODE_ENV=production`. Ces checks ne passent
   qu'en mode 2. (Compteur historique : la batterie compte désormais **71
   entrées** — 69 `phaseNN` + `schema-check` + `rls-behavior-check`.)
   **Le mode 1 ne suffit pas à qualifier un lot** : il ne joue ni phase26 ni les
   rôles de production, et c'est précisément là que le 24/09 une régression a
   échappé (voir `docs/CI-DATABASE-JOB-FINDINGS.md` § 24/09/2026).
2. **Gate D — mode rôles de production (l'équivalent exact du job `database` CI)** :
   ```bash
   ALLOW_DATABASE_RESET=1 \
   DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
   node scripts/test-production-roles.mjs
   ```
   Re-bootstrape les rôles (secrets aléatoires), re-migre, joue phase26
   destructif puis la **suite complète avec `PRODUCTION_ROLE_TESTS=1` +
   `APP_DATABASE_URL=creche_app`** + contrôles de contrat + preuves H2/G.
   Les parties Docker/Flutter-only s'écartent d'elles-mêmes localement
   (« NOT EXECUTED locally (Docker required) »). **Résultat du 2026-09-21 sur
   PG 18.4 : 65/65 suites vertes, preuves H2a–H2l et G1–G5 OK, rc=0.**
   C'est le gate à rejouer avant tout merge sensible.

   **Reproduire la condition du job CI** (et non seulement celle du bac à
   sable) — le job `database` exporte `RATE_LIMIT_DISABLED: 'true'`, que les
   spawns de production refusent depuis le lot 1 du plan de réparation :
   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
     RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local \
     STORAGE_LOCAL_DIR=/tmp/creche-storage-ci PAYMENT_WEBHOOK_SECRET=phase8-test-secret \
     ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
   ```
   Toute suite qui lance une **entrée de production** (`apps/api/dist/main.js`,
   `apps/worker/dist/main.js`) neutralise le raccourci avec
   `PRODUCTION_SPAWN_ENV` (`tests/tenant-isolation/helpers.mjs`) ; `phase26` le
   vérifie pour tout le dépôt (verrou).

## État de validation (2026-09-21, sandbox sans Docker)

- **Voie B : VALIDÉE** — PG 18.4 embarqué : 75/75 migrations, seeds,
  `schema-check` ✓, `rls-behavior-check` (GATE) ✓, build api+worker ✓,
  smoke API `{"status":"ok"}` sur `/api/v1/health`, **Gate D 65/65 vert**
  (rôles de production, see § modes ci-dessus).
- **R2 : VALIDÉE** — `.env.prod.example` rempli (TOTP incluse) passe
  `validateProductionConfig` ; `npm run check:env-example` vert.
- **Voie A : À FAIRE sur machine avec Docker** (non disponible dans la
  sandbox d'exécution) — à rejouer à la porte G-local sur la cible.

## Dépannage

- **Erreur de lecture du volume** (« … initialized with version 16 ») :
  ancien volume PG16 → nouveau `-p` (recommandé) ou `down -v`.
- **Build image long au 1er run** : `npm ci` + build du monorepo dans l'image
  (5–15 min, normal).
- **Vite 403** : le proxy dev accepte les hosts locaux et `.e2b.app`, refuse
  un domaine arbitraire (runbook H1).
- **MIGRATION_ROLE_UNSAFE** : ne jamais lancer `migrate.mjs` avec le rôle app
  (garde D — comportement correct ; le runner exige `creche_migrator`).
- **Données de test** : `run_pg.mjs` écrit dans `/tmp/pgtest` (purgeable,
  jamais de données réelles).
