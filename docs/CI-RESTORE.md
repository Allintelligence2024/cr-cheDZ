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
pose PRODUCTION_ROLE_TESTS=1. Le runner exécute d’abord `test-worker-monitoring-stack.mjs` (Docker, promtool, vrais services,
récepteurs de test), remet le schéma à neuf, puis les 31 suites et le diagnostic
F0. Aucun fichier workflow modifié. Le gate E2 n'est pas ignoré
si Docker échoue. Hors GitHub Actions, RUN_MONITORING_STACK=1 l'active explicitement.
Le diagnostic F0 constate des défauts non corrigés : ne pas le lire comme gate F4.


Résultat acquis : PR #44 / commit `955b9cd`, run `34826565565` : **9/9 checks
verts**, dont database (gate D strict + vrai gate E2 Docker + diagnostic F0) et
les quatre images. Les coordonnées réelles de notification restent à configurer.


### Complément F1/F3 — contrat partagé et curseurs int64

Le gate D exécute maintenant `scripts/check-sync-contract.mjs` avant la batterie :
- vérification sans écriture des artefacts générés ;
- 49 cas JSON Schema/AJV comparés aux vrais DTO ;
- **Dart obligatoire sur GitHub**, image `dart:3.9.4-sdk`, source read-only,
  réseau du conteneur coupé, pas de package pub ni SDK dans Git ;
- capture de six requêtes sérialisées par le client généré, puis validation
  schéma/DTO. Rapport temporaire et JSON synthétique dans les logs (aucun secret).

`--node-only` est réservé au local sans SDK : le message annonce explicitement
que Dart n'a pas été exécuté. Ce flag est interdit sur GitHub. `RUN_SYNC_DART=1`
active le gate Dart dans le runner local (`SYNC_USE_DOCKER=1` pour Docker).

La batterie contient maintenant **32 suites/contrôles**, phase29 incluse. Le
reset/migrate/seed avant les suites reste obligatoire. Le diagnostic F0 historique
n'est plus exécuté : il exigeait les bugs de curseur que F3 corrige. Sa couverture
API positive est reprise dans phase29 (26 assertions, dont limites int32/JS/int64).

**Ce gate est F1, pas F4** : le transport Dart est un enregistreur, la suite API
utilise Node ; le moteur Flutter/Drift et les producteurs child restent ouverts.
Aucun workflow modifié. Voir [contrat sync](architecture/sync-contract.md).


### Complément F2 — vrai Flutter/Drift, SDK et lockfile alignés

`check-staff-sync.mjs` est appelé en premier dans le gate D sur GitHub (ou
RUN_STAFF_SYNC=1 local). Il utilise Flutter **3.47.1**, copie l'app dans le
conteneur, exécute `pub get --enforce-lockfile`, tous les tests Flutter puis
`flutter analyze --no-fatal-infos`. Erreur/timeout = échec du job database.
Les résultats et erreurs synthétiques sont également des annotations GitHub.
Aucun workflow modifié. Sans SDK/Docker ici, aucune exécution Flutter locale.

Le gate historique Flutter d'analyse seul ne constitue pas cette preuve. Les
premiers vrais tests ont révélé une classe Drift/imports incorrects, puis deux
appels sans device. Après correction : moteur réel, Drift natif, stockage par
scope, page/curseur atomiques et réponses tardives. La batterie API compte
**33 suites/contrôles**, avec phase30 et ses 7 assertions de sécurité/reprise device.
Le détail et les réserves F3/F4 sont dans `PHASE_F2_CLIENT_RUNBOOK.md`.


### Complément F3a — conflits et résultats transactionnels

`phase31-sync-outcomes.api.test.mjs` porte la batterie à **34 suites/contrôles**.
Vrai HTTP/PG : 0/15 avant correction, puis 18/18 ciblés ; contrôle de version
avant mutation, rejeu durable, concurrence et échec réel au COMMIT. Le test
injecte aussi une exception après la vraie écriture du journal pour vérifier
le rollback intégral. Migration additive 058, sans modifier 001–052/055.

La suite tourne avec le rôle `creche_app` dans le gate strict, sans grants
ajoutés par les helpers. Aucun workflow modifié. Les résultats du dernier HEAD
sont dans la PR #44 ; voir `PHASE_F3A_OUTCOMES_RUNBOOK.md` pour les preuves,
le rollback et les limites historiques de ce lot (clôture fonctionnelle F ci-dessous).


### Complément F3b — enfants et tombstones

La batterie passe à **35 suites/contrôles** avec phase32 : 13 contrôles HTTP/PG,
bootstrap/rejeu de la migration 059 et pagination statique 501 enfants compris.
Flutter : 9 nouveaux tests du projecteur/vrai écran ; reproduction 23/31 sur
2300816 avant correction. Résultat final : dernier HEAD de la PR #44, gate strict
`database`, pas seulement `flutter-check`.

Les teardowns historiques purgent leur changelog synthétique **après** les enfants,
car leur suppression physique produit désormais un tombstone. Le premier essai
a réellement échoué sur les FK de nettoyage (RLS/phase4/phase5/phase6), sans défaut
dans les assertions métier. Ne jamais désactiver le trigger/RLS pour contourner
ce nettoyage. Voir `PHASE_F3B_CHILDREN_RUNBOOK.md` ; les lots F suivants sont documentés ci-dessous.


### F3c / F4 — publication ordonnée et vraie API

Batterie désormais **36 suites/contrôles** avec phase33 (10 contrôles). Migration
060 : allocation sous verrou par tenant, append-only applicatif. Reproduction
A lente/B rapide effective avant correction, pages de 500 comprises.

Après rôle/migration/seed, `test-production-roles.mjs` lance obligatoirement
`test-sync-api-flutter.mjs` sur GitHub : vraie API asynchrone, rôle creche_app,
vrai Flutter/Drift/Dio, cinq tests + assertions PG. Puis reset/migrate/seed avant
les suites historiques. SDK éphémère/lock imposé via le bootstrap commun F2 ;
aucun workflow modifié. `RUN_SYNC_E2E=1` local, avec SDK ou Docker ; absence locale
annoncée explicitement, jamais un gate F4 simulé.

Preuve rouge 7d0b520 : 3/5, date et version de présence incorrectes. Validation
finale : annotation **F4 Flutter API passed** du dernier HEAD de la PR #44.
Ce gate réel enfants/présences ne qualifie pas les autres projections ou l'APK
release. Voir `PHASE_F3C_F4_RUNBOOK.md` pour sécurité des fixtures et rollback.


## Clôture F et début H1 (PR #44)

Le runner des rôles de production contient désormais 37 suites/contrôles et deux
preuves distinctes obligatoires :
- `F4 Flutter API passed` : sept tests réels, quatre types produits, inspection PG.
  Baseline étendue `33ab34e` : 4/7, avant correction journal/media et reprise.
- `H1 staging passed` : vrai compose staging synthétique, images livrées,
  bootstrap/migration/seed/schema-check, HTTP health API et job worker `done`.
  MinIO Docker Hub a échoué dans nos runs ; pin Quay versionné/digest, pull réel
  requis. Le test n'est pas remplacé par le contrat structurel (11 assertions).

Aucun workflow modifié. Sans Docker/Flutter, le local n'est pas une preuve de ces
deux gates ; la CI doit être verte sur le dernier HEAD. H1 est indépendant mais
son échec reste bloquant pour le gate global. Aucun déploiement réel.
Voir [runbook F/H1](PHASE_F_COMPLETION_H1_RUNBOOK.md) pour les limites (métadonnées
seulement, pas de release Android ni de qualification G/H2/H3/dev/prod).


### H1 — vrais défauts de l'image runtime, après restauration de MinIO

Sur `d9d2720`, F4 est **7/7 vert avec PG**, mais le compose révèle un crash API :
`@aws-sdk/s3-request-presigner` était une dépendance de développement racine,
absente après prune. Le test isolé `scripts/check-api-runtime.mjs` reproduit ce
crash, puis un second défaut : `bcryptjs` 2.x installé sous `apps/api/node_modules`
n'était pas copié dans l'image. Ce sont deux défauts invisibles à un simple build.

L'API déclare maintenant ses deux imports AWS comme dépendances runtime et son
Dockerfile copie ses modules non hoistés après prune. Le lock ne change que de
classification/ownership (2 ajouts, suppression d'un flag `dev`) : **aucune version,
URL d'artefact ou intégrité modifiée**. Métadonnées actualisées par
`npm prune --package-lock-only --ignore-scripts`, puis `npm ci` et audit prod 0.

Le nouveau garde, obligatoire avant H1/F2/F4, fait un `npm ci --omit=dev` neuf hors
du dépôt et charge le vrai `app.factory.js` dans la disposition des COPY de l'image.
Il n'a ni NODE_PATH de développement ni fallback sur les node_modules du checkout.
Ce garde d'import n'est pas substitué au vrai bootstrap HTTP/worker du compose.
