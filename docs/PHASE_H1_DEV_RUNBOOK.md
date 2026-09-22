# H1 — Environnement de développement reproductible

2026-09-14, branche Arena / PR #44. Données synthétiques uniquement.
Aucun merge, déploiement client, changement de migration ou de lockfile dans ce lot.

## Reproductions avant correction

- Les contextes `apps/api` et `apps/worker` ne contiennent ni le lock racine ni
  `packages/prod-config`, pourtant requis par leurs manifests et tsconfig.
- Le Dockerfile dev du web n'existe pas ; les anciens Dockerfiles exécutent
  `npm install` au lieu de l'installation verrouillée.
- Les montages `apps/<service>:/app` masquent la structure du monorepo.
- Le compose confie PostgreSQL et le migrateur à `creche_app`. Sur un vrai PostgreSQL
  jetable, `NODE_ENV=development node scripts/migrate.mjs --check` avec cette
  identité échoue avec **MIGRATION_ROLE_UNSAFE**, avant DDL. La garde est correcte.
- Le test HTTP réel Vite avec un upstream configuré sur un port éphémère reçoit
  **500** : l'ancien proxy appelle toujours son propre `localhost:3000`.
- Une véritable requête HTTP portant un Host Arena reçoit **403** avec l'ancien
  Vite. Les tests utilisent `node:http` pour garantir l'envoi de Host (le fetch
  Node utilisé initialement ne transmettait pas la surcharge attendue).

Première suite : **0/8**. Après séparation du contrôle Host : **9/9** ciblés verts
(7 contrôles Compose + 2 tests HTTP Vite), et **20/20** avec le contrat prod/staging.
Ces tests structurels ne remplacent pas le véritable démarrage Docker.

## Corrections

- Trois Dockerfiles dev, contextes à la racine du monorepo, Node 22, `npm ci`,
  build de `@creche/prod-config`, commandes exécutées dans leurs workspaces.
- API : Nest en mode watch ; web : Vite ; worker : `ts-node` comme précédemment.
- Montages de `src` seulement, en lecture seule dans les conteneurs. Les éditions
  faites sur l'hôte restent visibles, sans écraser le monorepo ni ses dépendances.
- `postgres` admin → bootstrap des rôles → `creche_migrator` pour migration/seed →
  schema-check avec `creche_app` → API/worker. Aucun relâchement de la garde D.
- Les paramètres Docker dev sont **DEV_*** : une variable DATABASE_URL ou un
  secret de production exporté sur l'hôte n'est pas réutilisé implicitement.
- Le navigateur conserve ses URLs `/api/v1/...`. Vite reçoit `API_PROXY_TARGET`
  côté serveur (`http://api:3000` dans Docker), pas une URL Docker dans le bundle.
- Vite accepte les hosts locaux et `.e2b.app`, mais refuse un domaine arbitraire.

## Démarrage sur une installation neuve

```sh
# Racine du dépôt ; projet distinct pour ne pas réutiliser un ancien volume.
# (R1 2026-09-21 : passe à -p creche-dev-v3 — un volume formatté PG16 n'est
#  pas lisible par PG18, cf. BACKUP-RUNBOOK « Upgrade PostgreSQL 16 → 18 ».)
docker compose -p creche-dev-v3 -f infrastructure/docker/docker-compose.dev.yml up --build
```

Web : `http://localhost:4000`. API : `http://localhost:3000/api/v1/health`.
Il n'y a pas de compte client ni de données de démonstration créés par ce lot.
Utiliser uniquement des fixtures synthétiques et une procédure de création de compte
approuvée ; ne jamais ajouter de compte administrateur universel au seed.

Paramètres facultatifs (via environnement ou `--env-file` explicite) :

| Paramètre | Défaut / usage |
|---|---|
| `DEV_POSTGRES_DB` | `creche_dev` |
| `DEV_POSTGRES_PASSWORD`, `DEV_APP_DATABASE_PASSWORD`, `DEV_MIGRATOR_DATABASE_PASSWORD` | trois valeurs **de développement**, distinctes ; app/migrateur >=16 caractères |
| `DEV_JWT_SECRET`, `DEV_JWT_REFRESH_SECRET` | secrets **de développement**, ne jamais utiliser en production |
| `DEV_POSTGRES_PORT`, `DEV_API_PORT`, `DEV_WEB_PORT` | 5432 / 3000 / 4000 |
| `DEV_MINIO_PORT`, `DEV_MINIO_CONSOLE_PORT` | 9000 / 9001 |
| `DEV_MINIO_ROOT_USER`, `DEV_MINIO_ROOT_PASSWORD` | accès de développement uniquement |
| `DEV_WEB_BIND` | `127.0.0.1` ; `0.0.0.0` uniquement pour un preview protégé / réseau de confiance |
| `DEV_WORKER_SCHEDULER_ENABLED` | `true` ; les fréquences E et la facturation automatique OFF sont inchangées |

Les ports PostgreSQL et MinIO restent sur loopback, même avec `DEV_WEB_BIND=0.0.0.0`.
Pour un preview Arena, ouvrir le port web proxifié par Arena ; les requêtes API
restent relatives. Ne pas demander au navigateur de contacter son propre localhost.

API/web : les changements de source sont surveillés. Worker : redémarrer le service
après édition. Pour un manifest, lock, config ou package partagé : reconstruire
les images ; aucun volume node_modules ancien n'est recyclé.

## Données existantes, arrêt et rollback

Les anciens volumes dev peuvent appartenir au superuser `creche_app`. **Ne pas les
réutiliser aveuglément et ne pas supprimer les volumes pour faire passer bootstrap.**
Le nouveau mot de passe / POSTGRES_USER n'est pas appliqué par PostgreSQL à un volume
existant. Utiliser un nouveau nom de projet comme ci-dessus, ou sauvegarder/vérifier
le volume et suivre le runbook D avant une migration explicite des propriétaires.

Arrêt sans destruction :

```sh
docker compose -p creche-dev-v2 -f infrastructure/docker/docker-compose.dev.yml down
```

Ne pas ajouter `--volumes` si des données doivent être conservées. En cas d'échec,
arrêter, garder les volumes et diagnostiquer les logs expurgés. Ne pas revenir à
l'identité applicative superuser ni retirer des contraintes pour redémarrer.
Les anciens volumes ne sont pas modifiés par le projet neuf.

## Gates

```sh
node --test tests/tenant-isolation/dev-compose-contract.test.mjs tests/tenant-isolation/dev-proxy.test.mjs
ALLOW_DATABASE_RESET=1 node scripts/test-staging-stack.mjs --dev
```

La seconde commande nécessite Docker. Le runner CI existant exécute **staging puis
dev**, sans modifier les workflows. Les deux sont bloquants ; notices distinctes
`H1 staging passed` et `H1 dev passed`, à vérifier sur le dernier HEAD de la PR #44.
Dev construit les trois images livrées, démarre le vrai compose, vérifie HTTP API,
proxy Vite → API, HTML web et un job réellement terminé par le worker. Projet et
volumes synthétiques uniques, ports loopback éphémères, scheduler arrêté dans la
fixture, aucun provider réel hérité. Les volumes du seul projet de test sont détruits.

Local, sans Docker : migration/seed/schema-check avec rôles séparés, vrai Nest
`start:dev`, vrai Vite → API et vrai worker `ts-node` traitant un job en une tentative
ont été vérifiés. Cela **ne constitue pas** une exécution locale des conteneurs.

## Frontière avec H2/G

Ce lot ne qualifie pas la sécurité de production, MinIO/CVE, buckets et uploads
S3 depuis le navigateur, les notifications externes, toute l'UI métier ou Android.
G, H2 et H3 restent ouverts. Prochaine grappe H2 : confidentialité selon la matrice
commune journal/exports/privacy/notifications, après reproductions ; aucune règle
métier de paie n'est déduite des décisions E5.

### Régressions locales de ce lot

- `npm ci` puis typecheck et build de tous les workspaces : verts.
- `npm run lint` (`--max-warnings=0`) : vert.
- Unitaires API : **27/27** ; `npm audit --omit=dev` : **0 vulnérabilité**.
- Gate des rôles, reset → migrations → seeds puis isolation : **37/37 suites**.
- Les gates Docker et Flutter restent explicitement non exécutés localement ;
  leur statut final doit être lu sur le commit courant de la PR, pas hérité de a2ab4f4.

### Preuve Docker réelle — commit `0870317`

[CI 34868421539](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34868421539),
check database **104057998864**, succès en **21m50s** ; les **9/9 checks** du commit
`0870317788b8aa19c2ae48d409a5509ead833d4d` sont verts. Notices vérifiées via l'API des
annotations GitHub, pas seulement l'exit code du watcher :

- **H1 dev passed** : Compose livré, bootstrap, migration, seed, schema-check,
  santé HTTP API, proxy/HTML Vite et job worker terminé (une tentative).
- **H1 staging passed** : même preuve bootstrap/runtime staging conservée.
- **F2 Flutter passed** : 51 vrais tests et analyse.
- **F4 Flutter API passed** : 7 vrais tests Flutter/Drift → HTTP API + PostgreSQL.

H1 dev est qualifié dans ce périmètre synthétique. Les restrictions G/H2/H3,
stockage complet et Android release ci-dessus ne sont pas levées. Les mises à jour
de documentation qui consignent cette preuve ne changent pas le code testé.
