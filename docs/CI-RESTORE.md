# Restauration des workflows GitHub Actions

**Contexte** : la GitHub App utilisée par l'agent de développement n'a pas la
permission `workflows` — GitHub refuse de créer/mettre à jour
`.github/workflows/*` via ce token (push rejeté : « refusing to allow a
GitHub App to create or update workflow … without workflows permission »).

## État actuel

- Les workflows **ci.yml** (database → 23 suites schema-check…phase20, api,
  web, security avec CodeQL, e2e Playwright) et **docker.yml** (api, worker,
  admin-web, support-console → ghcr.io/creche-saas) sont prêts dans
  `.github/workflows/` du dépôt local, ainsi que les Dockerfiles des 4 apps.
- Ils sont **non commités** (le commit de restauration a été retiré de la
  branche pour ne pas bloquer les pushs).
- **2026-08-02** : les versions locales d'origine ont été perdues avec
  l'espace de travail — les fichiers présents ont été **réécrits** à partir
  de la description ci-dessus (mêmes jobs). Nouvelle tentative de push :
  toujours refusé sans la permission `workflows` (« refusing to allow a
  GitHub App to create or update workflow .github/workflows/ci.yml »).
  **Action humaine requise** : accorder la permission `workflows` à la
  GitHub App, puis exécuter la commande de restauration ci-dessous.
- NB e2e : les specs Playwright (login + director-flow) n'ont JAMAIS été
  exécutées — le premier run CI du job e2e peut échouer sur la spec elle-même
  (chemins, sélecteurs) ; corriger la spec, jamais l'application.

## Restaurer (une seule commande, depuis le dépôt)

```bash
git add .github apps/worker/Dockerfile
git commit -m "ci: restore GitHub Actions workflows"
git push origin arena/019fbeff-cr-chedz
```

## Alternative — accorder la permission à l'App

1. GitHub → Settings → Developer settings → GitHub Apps → **Arena** →
   Permissions → **Workflows : Read and write**.
2. Relancer le push du commit ci-dessus.

## Contenu des workflows (prêts à l'emploi)

| Fichier | Rôle |
|---|---|
| `.github/workflows/ci.yml` | Jobs : **database** (migrations + seeds + schema-check + GATE RLS + isolation + phases 3→11), **api** (typecheck + build), **web** (admin + support), **security** (npm audit + CodeQL), **e2e** (Playwright parcours directeur) |
| `.github/workflows/docker.yml` | Build des images `ghcr.io/creche-saas/{api,worker,admin-web}` (dev/staging/tags v*) |

## Alignement PostgreSQL 18 (audit 2026-08-23)

Le ci.yml réécrit utilise **postgres:18** (et non 16/17) : toute la
validation projet tourne sur PostgreSQL 18 réel (embedded-postgres
18.4.0-beta.17 en local) — lancer la CI sur un moteur différent masquerait
des bugs de compatibilité (exemple historique : jobs_finish 024→048, CASE
text vs enum, invisible sur un moteur non validé). Le fichier local
(`.github/workflows/ci.yml`) reste NON TRACKÉ tant que la permission
`workflows` manque ; il exécute : npm ci → typecheck → migrate+status
(001→050) → seeds → schema-check (+ garde RLS) → rls-behavior-check →
build api+worker → suites isolation+phase3→phase22 via
`scripts/run-isolation-suites.sh`, plus jobs admin-web/support-console
(typecheck+build) et security (npm audit --omit=dev).


## 2026-09-14 — Gate Phase D (action humaine `workflows`)

Les workflows sont désormais suivis et la PR #37 est mergée. Les sections
antérieures décrivent l'historique, pas l'état courant ; ne pas pousser vers les
anciennes branches de session mentionnées ci-dessus.

Après `npm ci`, typecheck et **build API + worker**, remplacer la préparation de
base et l'appel historique des suites du job `database` par :

```yaml
- name: Gate D/E — rôles/grants de production + régressions + 31 suites
  env:
    ALLOW_DATABASE_RESET: '1'
    # DATABASE_URL hérité : administrateur du service PostgreSQL CI jetable.
    # Base *_test et cluster dédié obligatoires, jamais une base de staging/prod.
  run: npm run test:production-roles
```

Le runner génère deux secrets de test distincts, applique le bootstrap livré,
exécute les migrations et seeds comme `creche_migrator`, et force les connexions
API/worker/RLS à `creche_app` sans grants ad hoc des helpers. Les fixtures et les
vérifications hors API conservent leur connexion administrateur de test.
`schema-check` utilise aussi la connexion applicative. Le runner remet la base à
zéro avant les suites historiques, dont phase3/4 dépendent.

Aucune modification de `.github/workflows/*` n'est incluse dans la Phase D.
Le succès local n'est pas un résultat CI tant que cette étape n'est pas câblée.


### Complément E1 — même commande, 53 migrations et 30 suites

Le runner inclut désormais `phase27-worker-lifecycle.test.mjs` après les 29
contrôles historiques. Il teste de vrais processus (SIGKILL/SIGTERM/SIGINT), les
baux, les heartbeats et la concurrence. Les quatre tests initiaux étaient rouges
avant 053. Aucun workflow n'est modifié automatiquement ; les réserves de droits
restent celles du plan de reprise. Voir `PHASE_E_WORKER_RUNBOOK.md`.


### Complément E2–E6 — 56 migrations, 31 suites et gate Prometheus séparé

Le runner inclut `phase28-worker-reliability.test.mjs` après E1 et ajoute trois
précontrôles **structurels** de monitoring. Les fixtures API/worker utilisent
les vrais rôles de production. La mensualité automatique reste désactivée par
choix du client. Migration 055 réservée à G2, ne pas renuméroter 056/057.

Le gate distinct `npm run check:worker-monitoring` exige **promtool 2.53.0** et
évalue `tests/monitoring/worker-alerts.test.yml`. Il sort avec code 2 quand le
binaire manque. L'installer dans le runner (ou fournir `PROMTOOL`) et câbler ce
gate en CI ; ne pas le remplacer par les tests structurels ni ignorer son code.
Le binaire ne doit pas être committé. Les téléchargements ont échoué dans le
sandbox : aucun succès promtool n'est revendiqué pour cette session.

La validation de réception opérateur et des images Compose reste un gate staging
supplémentaire. Aucun changement `.github/workflows/*` inclus, permission humaine
requise. Voir le runbook phase E et ADR-013.


### Complément E2 / F0 — raccordement sans modification des workflows

Dans GitHub Actions, `scripts/run-isolation-suites.sh` délègue maintenant au
runner strict D quand il n'est pas déjà dans ce mode. Pas de récursion : celui-ci
pose PRODUCTION_ROLE_TESTS=1. Après les 31 suites, le runner exécute le diagnostic
F0 et `test-worker-monitoring-stack.mjs` (Docker, promtool, vrais services,
récepteurs de test). Aucun fichier workflow modifié. Le gate E2 n'est pas ignoré
si Docker échoue. Hors GitHub Actions, RUN_MONITORING_STACK=1 l'active explicitement.
Le diagnostic F0 constate des défauts non corrigés : ne pas le lire comme gate F4.
