# Phase D — séparation PostgreSQL, installation neuve

## Décision D0 — 2026-09-14

Le client confirme : **aucune production déployée**, propriétaires non applicables,
sauvegarde de production non applicable. Travaux et reproductions uniquement sur
une base locale jetable. Aucun accès ni changement en production autorisé ici.
Les migrations 001–052 restent immuables.

## Plan de retour arrière (écrit avant correction)

- Avant le premier déploiement : conserver la version d'image et la configuration
  précédentes dans le coffre de l'opérateur, sans les committer.
- En cas d'échec bootstrap/migration/garde : ne pas lancer API/worker, ne pas
  contourner les gardes et ne jamais rétablir SUPERUSER pour l'application.
- Installation encore vide : corriger la configuration puis relancer bootstrap et
  migrations idempotents. Une recréation du volume exige une autorisation humaine
  distincte ; aucune commande de suppression de volume n'est exécutée ici.
- Dès l'arrivée de données réelles : arrêter les écritures API/worker, sauvegarder
  et **restaurer hors production** suivant BACKUP-RUNBOOK.md avant tout changement
  de rôles/propriétaires. Prévoir une fenêtre de maintenance. Ce chemin n'est pas
  validé par les tests d'installation neuve.
- Si les tables appartiennent à `creche_app`, arrêter : transfert de propriété
  contrôlé par un administrateur requis, jamais une rétrogradation aveugle.

### Ordre de révocation des rôles (retour arrière)

Les migrations sont **forward-only** (ADR-007) : aucun `DOWN` n'existe. Un retour arrière
complet = **restauration d'une sauvegarde** ([BACKUP-RUNBOOK.md](BACKUP-RUNBOOK.md)) + image
applicative précédente, puis — seulement si l'on veut aussi retirer la séparation des rôles —
révocation dans cet ordre strict (du plus privilégié au moins privilégié, pour ne jamais
laisser `creche_app` sans le cadre attendu) :

1. **Arrêter les écritures** : scale à 0 l'API et le worker (aucune connexion applicative
   active). Vérifier `pg_stat_activity` : plus aucune session `creche_app`/`creche_migrator`.
2. **Révoquer les grants de `creche_app`** (le moins privilégié d'abord) :
   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM creche_app;
   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM creche_app;
   REVOKE USAGE ON SCHEMA public FROM creche_app;
   ```
3. **Révoquer les grants de `creche_migrator`** :
   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM creche_migrator;
   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM creche_migrator;
   REVOKE CREATE ON SCHEMA public FROM creche_migrator;
   ```
4. **Ne PAS `DROP ROLE` tant que des objets appartiennent à `creche_migrator`** :
   la propriété du schéma reste au propriétaire. Un changement de propriétaire
   (`REASSIGN OWNED` / `ALTER … OWNER TO`) est une décision humaine distincte, jamais
   automatisée ici.
5. **Réappliquer la configuration précédente** (rôle unique si l'on revient au modèle
   pré-D) puis relancer bootstrap + migrations idempotents depuis l'image précédente.

> Garde-fou : après révocation, redémarrer l'API doit échouer proprement sur la garde
> `DATABASE_ROLE_UNSAFE` si le rôle attendu n'a plus ses privilèges — c'est le comportement
> voulu, pas un rétablissement SUPERUSER.

### Qui décide

- **Déclenchement du retour arrière** : le responsable d'exploitation (OPS) seul, après
  constat d'échec bootstrap/migration/garde en production.
- **Restauration de sauvegarde** (chemin « données réelles ») : validation conjointe OPS +
  responsable conformité (RGPD/ANPDP), car elle réintroduit un état antérieur de données
  personnelles. Fenêtre de maintenance annoncée.
- **Changement de propriété / `DROP ROLE`** : administrateur PostgreSQL de l'organisation,
  jamais l'agent ni un script automatisé.
- L'agent (Arena/Antigravity) **prépare** les commandes et le diagnostic, il ne les exécute
  pas en production.

## Modèle cible

- `postgres` : bootstrap administrateur uniquement ; jamais transmis à API/worker.
- `creche_migrator` : LOGIN, NOSUPERUSER, BYPASSRLS, NOCREATEDB, NOCREATEROLE ;
  propriétaire du schéma et des objets métier. BYPASSRLS est nécessaire aux
  fonctions SECURITY DEFINER existantes (auth, jobs globaux) sur tables **FORCE**
  RLS. Être propriétaire seul ne suffit pas. Secret réservé au déploiement.
- `creche_app` : LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE,
  NOREPLICATION ; aucun rôle parent, aucune propriété, pas de CREATE sur public.
- Secrets bootstrap/migrateur/app distincts, jamais en Git ni en sortie des tests.

Les fixtures/tests peuvent utiliser un administrateur pour préparer et inspecter
les données. En revanche, migrations = migrateur et **toutes les connexions
API/worker et RLS = creche_app**, sans grants ajoutés par les helpers de test.

## Installation neuve — opérateur uniquement

1. Construire et publier les images API/worker de **cette révision**. Bootstrap et
   migrate réutilisent l'image API (son `pg` installé par `npm ci` au build), pas
   une image Node nue effectuant un `npm install` réseau au démarrage.
2. Préparer `.env.prod` depuis `.env.prod.example`, via le coffre. Trois secrets
   distincts ; `DATABASE_URL` = app, `MIGRATION_DATABASE_URL` = migrateur, même
   base/hôte. Laisser `postgres` propriétaire de la base fraîche ; le bootstrap
   attribue le schéma et les futurs objets métier au migrateur.
3. Depuis la racine du checkout de la révision déployée :

   ```bash
   # Validation silencieuse : ne pas afficher un « compose config » contenant
   # les secrets résolus dans des logs publics.
   docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml config --quiet
   docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml up -d
   docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml ps -a
   docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml logs bootstrap-roles migrate
   ```

   Le graphe impose postgres healthy → bootstrap réussi → migrations/seeds et
   schema-check réussis → API/worker. `schema-check` utilise l'URL applicative.
   Les montages scripts/base/tests sont en lecture seule ; les fichiers du
   checkout doivent correspondre à la version des images.
4. Vérifier le health HTTP et les logs API/worker. Un `DATABASE_ROLE_UNSAFE` est
   un **arrêt**, jamais une raison de changer NODE_ENV ou d'accorder SUPERUSER.

Staging utilise le même graphe et les mêmes rôles. Son montage `tests/` est présent
pour le contrôleur de schéma. Cela ne valide pas à lui seul le gate H1 « compose
staging réellement démarré et healthy ».

### Limites de validation de déploiement

- Aucun accès production, aucun déploiement ni suppression de volume effectués.
- Pas de démon Docker ici : YAML analysé et contrat structurel testé, mais
  **ni `docker compose up` ni build des images Docker validés** dans cette session.
- Les tests SQL locaux utilisent PostgreSQL **18.4** (comme la CI existante).
  Les Compose dev/staging/prod sont alignés sur **18-alpine** depuis la
  remédiation R1 (2026-09-21) : la version cible est désormais celle de la CI.
  Ne jamais changer une version majeure sur un volume existant sans procédure
  dédiée (cf. BACKUP-RUNBOOK « Upgrade PostgreSQL 16 → 18 ») ; le montage de
  données de l'image PostgreSQL 18 diffère de celui de 16 → volume neuf en dev.
- PostgreSQL émet des avertissements `no privileges were granted` lors du
  GRANT global sur les fonctions d'extensions trusted (uuid-ossp/pgcrypto/pg_trgm) :
  ces fonctions restent propriétaires postgres et exécutables via leurs droits
  PUBLIC par défaut. Les fonctions métier SECURITY DEFINER, elles, sont bien
  propriétaires migrateur et leurs droits EXECUTE app sont vérifiés en test.
- Le Compose **dev historique** n'est pas couvert par ces validations. Il utilise
  encore `creche_app` pour le DDL, ce que le nouveau runner refuse : alignement
  des rôles/configurations dev à prévoir. La voie locale vérifiée ici est le
  PostgreSQL embarqué et la commande de gate ci-dessous, pas `compose.dev up`.
- Le postgres-exporter n'utilise plus les identifiants administrateur. Il utilise
  l'URL app ; la couverture des métriques PostgreSQL doit être vérifiée lors du
  smoke Docker (pas de GRANT pg_monitor ajouté à l'application pour contourner
  le contrôle des appartenances).

## Validation reproductible — base jetable uniquement

Prérequis : `npm ci`, build API + worker, PostgreSQL lancé (`node run_pg.mjs` via
un process long). **Cluster dédié** : les rôles PostgreSQL sont globaux au cluster,
même si seules les tables de la base `_test` sont réinitialisées.

```bash
npm run build --workspace @creche/api
npm run build --workspace @creche/worker
ALLOW_DATABASE_RESET=1 \
DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
npm run test:production-roles
```

Le runner génère les secrets de test (non affichés), exécute le contrat Compose et
les régressions D, rebootstrap les rôles, reset/migre/seede avec le migrateur,
puis rejoue les **29 suites/contrôles historiques + E1 (30 au total)** avec l'application réelle.
La migration 053 et la nouvelle suite sont décrites dans [le suivi E](PHASE_E_WORKER_RUNBOOK.md).
Les fixtures/inspections restent administrateur ; le code API/worker et les
requêtes du contrôle RLS sont exclusivement `creche_app`. Le mode
`PRODUCTION_ROLE_TESTS=1` interdit les grants ad hoc dans les helpers ;
`schema-check` vérifie aussi l'identité de sa connexion.

Le runner affiche un répertoire de logs `/tmp/creche-roles-gate-*`. Le gate exige
un **exit 0 global**, pas simplement des assertions vertes extraites des logs.
Pour câbler cette commande au job CI `database`, voir [CI-RESTORE.md](CI-RESTORE.md).
Aucun workflow n'a été modifié ; résultat CI de cette nouvelle commande **non acquis**.

## Preuves — 2026-09-14

Référence avant correctif : `d6f2dfe` (PR #37 mergée). Les quatre premiers tests
Phase D ont été écrits et exécutés **avant** de modifier le code : 0/4 verts.

| Régression | Avant | Après |
|---|---|---|
| Rôle existant `creche_app` superuser/bypass/createdb/createrole/replication | Attributs dangereux conservés | Tous retirés, deuxième bootstrap idempotent |
| Provider API avec login postgres en production | Accepté, « Missing expected rejection » | `DATABASE_ROLE_UNSAFE` |
| Migrateur lancé avec `creche_app` | Exit 0, registre de migrations créé | `MIGRATION_ROLE_UNSAFE`, aucun DDL |
| Nouvelle table du créateur migrateur | `42501 permission denied` pour l'app | Lisible sans GRANT manuel |

Couverture supplémentaire :

- **14/14 tests PostgreSQL Phase D** : BYPASSRLS seul, appartenance NOINHERIT,
  propriété et CREATE, administrateur masqué par SET ROLE, vrais entrypoints API
  **et worker** (refus avant écoute/claim et démarrage positif), secrets distincts,
  migration fictive lue via le provider API, réparation des grants sans nouveau
  DDL, registre de migrations non modifiable par l'app, fonctions SECURITY DEFINER
  appartenant au migrateur et exécutables par l'app.
- **8/8 tests de contrat Compose** ; **0/8** sur les fichiers extraits de
  `d6f2dfe`. Ce sont des tests structurels ciblés, pas un remplacement de Docker.
- **27/27 tests unitaires** (12 existants + 15 cas du garde PostgreSQL).
- `npm ci`, typecheck et lint `--max-warnings=0` : réussis ; `npm audit --omit=dev`
  : **0 vulnérabilité**. Les deux vulnérabilités annoncées par `npm ci` concernent
  l'arbre incluant le développement ; aucun `npm audit fix` exécuté.
- Garde Android : exit 0 (avertissements non bloquants préexistants).
- Inventaire routes : **172**, dont **44** sans `@Roles`/`@Public`, inchangé.
- Build de **tous les workspaces** : réussi.
- Migrations 001–052 et lockfile inchangés.
- **Gate 29/29 : VERT**, commande `npm run test:production-roles` terminée
  avec **exit 0** sur le cluster isolé (port 54330, base `creche_roles_test`).
  Les 14 tests Phase D précèdent la batterie. Les 8 tests structurels Compose,
  également verts, sont désormais intégrés au début de cette commande.

Un premier passage des suites a été invalidé par une modification du script bash
alors qu'il s'exécutait (exit 2 de l'orchestrateur, pas de résultat global valide).
Le gate est donc rejoué par la commande complète sur un second cluster isolé,
avec répertoire de logs dédié. Ce premier passage n'est pas compté comme preuve
29/29.

Résultat global retenu : **14/14 Phase D + 29/29 historiques, exit 0** sur le
second cluster. Le contrôle de schéma avec vérification explicite de l'identité
applicative et les tests Phase D ont aussi été rejoués séparément après les
derniers ajustements, avec succès. **Gate local D acquis ; déploiement Docker et
câblage CI restent à valider**, sans prétendre que la RLS a été testée dans une
production qui n'existe pas encore.
