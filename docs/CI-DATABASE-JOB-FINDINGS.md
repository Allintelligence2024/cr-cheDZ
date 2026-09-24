# Job CI « database » — du blocage de 6 h au vert

_Dernière mise à jour : 24/09/2026 — branche `arena/01a0d3c1-cr-chedz` (PR #50, plan de réparation)._

> **24/09/2026 — le job est redevenu rouge, pour deux causes distinctes** : un H1
> environnemental (tirage de registre refusé sur le runner, `main` incluse) et une
> **régression du lot 1 du plan de réparation** (raccourci `RATE_LIMIT_DISABLED`
> hérité par les spawns de production) — cette seconde cause est corrigée et
> verrouillée. Détail et preuves : section « 24/09/2026 » en fin de document.

## Résumé

Le job `database` était **bloqué 6 h puis annulé**, sans aucun diagnostic
exploitable. Il nomme désormais précisément ce qui ne va pas, et chaque cause
a été traitée. **Six défauts préexistants sur `main`** ont été mis au jour ;
**tous sont corrigés**, et le job **passe désormais en 27 min** (`52e6ef3`),
avec les gates G security, H2 confidentiality, F2/F4 Flutter et H1 dev/staging
tous verts.

Le déblocage s'est fait par élimination successive : chaque correctif laissait
le job aller plus loin et révélait la cause suivante, jusqu'à épuisement.

| Run | Symptôme | Cause trouvée |
|---|---|---|
| avant | 6 h, annulé | aucun garde-temps |
| `4bf1b3b` | échec à 14 min | PostgreSQL 18 ne démarrait pas |
| `baef7b6` | échec à 38 min | `phase62` ne rendait jamais la main + 3 suites parents |
| `8c64924` | 1 suite rouge | `ON CONFLICT` obsolète (préférences jamais enregistrées) |
| `18b159c` | 1 assertion rouge | course de lecture dans `phase11` (pas un bug produit) |
| `52e6ef3` | **succès en 27 min** | — |

Aucun de ces défauts ne vient de la refonte Sérénité. Ils ont été trouvés
**parce que** le job est devenu diagnosticable, puis corrigés ici ; ils étaient
tous déjà présents sur `main` avant cette branche.

## Pourquoi le blocage était invisible

Deux causes cumulées, toutes deux corrigées (`4bf1b3b`) :

1. **Aucun job n'avait de `timeout-minutes`.** Un blocage consommait le plafond
   GitHub de 6 h. Constaté sur `main` (`348bd74`) : job démarré à 14:39, annulé à
   20:40.
2. **L'orchestrateur Gate D lançait tous ses sous-gates sans timeout**, et le
   runner de suites n'écrivait le nom d'une suite qu'**après** sa fin. Une suite
   bloquée n'apparaissait donc jamais dans le log.

Désormais : chaque sous-gate et chaque suite annoncent leur nom **avant**
exécution (`▶ …`), un dépassement est distingué d'un échec d'assertion
(codes 124/137 de `timeout`, `ETIMEDOUT`/`SIGKILL` côté Node) et remonte en
annotation `Suite bloquée` / `Gate D bloqué`, lisible via l'API check-runs.

Budgets (surchargeables par variable d'environnement) :

| Portée | Budget | Variable |
|---|---|---|
| Sous-gate courant | 20 min | `GATE_STEP_TIMEOUT_MS` |
| Gates Docker/Flutter | 25 min | `GATE_FLUTTER_TIMEOUT_MS` |
| Batterie d'isolation | 45 min | `GATE_SUITES_TIMEOUT_MS` |
| Stacks Docker H1 | 40 min | `GATE_STACK_TIMEOUT_MS` |
| Chaque suite | 600 s | `SUITE_TIMEOUT` |

## Corrigé

### 1. `backup-drill` — client PostgreSQL trop ancien (`7a3c29a`) ✅

`pg_dump v16 < serveur PostgreSQL v18 : client trop ancien`. Le service tourne en
`postgres:18` mais le runner fournit un client v16, et `pg_dump` refuse par
conception de sauvegarder un serveur plus récent. L'étape d'installation était
conditionnée par `if ! command -v pg_dump` — toujours fausse, donc la v16 restait.
Désormais `postgresql-client-18` est installé depuis le dépôt PGDG.

### 2. Volume PostgreSQL sur un chemin refusé par l'image (`eba60bf`) ✅

Le gate H1 ne démarrait pas postgres, **sur les trois environnements, production
comprise** :

```
Error: in 18+, these Docker images are configured to store database data in a
format which is compatible with "pg_ctlcluster" […]
there appears to be PostgreSQL data in:
  /var/lib/postgresql/data (unused mount/volume)
```

Depuis `postgres:18`, l'image place les données dans
`$PGDATA=/var/lib/postgresql/18/docker` et déclare son `VOLUME` sur le parent
`/var/lib/postgresql` (`docker-library/postgres#1259`). Un volume monté sur
l'ancien chemin `/var/lib/postgresql/data` n'est jamais écrit : le conteneur
refuse de démarrer, **même sur un volume vierge**.

Les trois fichiers utilisaient déjà `postgres:18-alpine` avec le montage pré-18.
Le service `backup` n'est pas concerné (outils client uniquement, sans PGDATA).

> **Volumes existants** créés en 16/17 : le format sur disque diffère, il faut les
> recréer (`down -v`). Aucune donnée à préserver en dev/staging.

Garde : `tests/tenant-isolation/production-compose-contract.test.mjs` vérifie le
point de montage sur les 3 environnements.

### 3. Suite `phase62` bloquée : client PostgreSQL jamais fermé (`71e2c27`) ✅

Une fois les sous-gates bornés, la garde a nommé la coupable :
`phase62-payroll-finalized-lock n'a pas rendu la main en 600s`.

La suite exécutait tout son travail, affichait « validée », puis figeait. Son
client d'amorçage (celui qui appelle `ensureAppRole`) n'était jamais fermé : un
`pg.Client` connecté maintient un socket actif, et Node ne sort pas tant qu'un
handle reste ouvert. Ses trois autres clients étaient bien fermés ; la suite
sœur `phase63`, de structure identique, ferme le sien.

Vérification de l'ensemble des suites : c'était la seule vraie fuite.
`phase27` (fermeture dans un hook `after`) et `phase32` (teardown groupé) sont
des faux positifs du comptage textuel.

Garde : `tests/tenant-isolation/client-leak-guard.test.mjs` compare `.connect()`
et `.end()` par suite, avec exemptions justifiées. Statique, donc exécutable
sans PostgreSQL.

### 4. Liste des photos parent toujours vide (`b70e81f`) ✅

`GET /parent/children/:id/media` renvoyait **toujours** une liste vide, alors
que le téléchargement direct de la même photo fonctionnait — asymétrie qui
rendait le défaut déroutant.

`ParentsService.photos()` passait par `MediaService.list()`, qui cloisonne le
**personnel** par salle : il lit `memberships.room_ids` et retourne `[]` dès que
c'est vide ou NULL pour un rôle hors `director`/`super_admin`/`accountant`. Or un
parent (`parent_primary`/`parent_secondary`) n'appartient à aucune salle.

Correctif : `MediaService.listForParent(childId)`, qui filtre sur l'enfant et sur
`is_visible_to_parents`. Les garde-fous restent portés par l'appelant, seule voie
d'accès parent : `assertPermission(..., 'can_view_journal')` avant toute lecture,
`is_visible_to_parents = true` dans la requête, consentement revérifié par
`photoUrl()` à chaque signature (révocation immédiate), RLS par organisation
inchangée. Le chemin personnel n'est pas touché.

Corrige les trois suites : `phase7-parent`, `phase37-parent-revocation`,
`phase41-photo-consent-scope`. Couvert hors base par
`apps/api/src/modules/parents/parent-photos.spec.ts` (4 tests).

## Corrigé — 5. Préférences de notification jamais enregistrées

**Symptôme** : `phase7-parent` — `Préférence désactivée : aucun push en file — file=1`.
Un parent qui désactivait ses notifications continuait d'en recevoir.

**Cause** : la logique de `notifications.service.ts` était correcte ; c'est
l'écriture de la préférence qui échouait, en amont. La migration `073` a
remplacé, sur `notification_preferences`, `UNIQUE (user_id, channel, event_type)`
par `UNIQUE (organization_id, user_id, channel, event_type)` pour permettre à un
utilisateur multi-crèche d'avoir des préférences par tenant. `savePreference()`
visait toujours l'ancienne combinaison. PostgreSQL exige qu'un `ON CONFLICT`
corresponde exactement à une contrainte existante : la requête était rejetée, la
préférence jamais écrite. Le test n'inspectant pas la réponse du POST, l'erreur
restait invisible jusqu'au check-in suivant.

**Pourquoi aucun outil ne pouvait le voir** : ni TypeScript, ni ESLint, ni les
tests unitaires ne lisent le SQL. Seule une base réelle rejette la requête.

**Garde** : `tests/tenant-isolation/on-conflict-targets.test.mjs` rejoue les
migrations **dans l'ordre** puis vérifie chaque `ON CONFLICT` du code. Trois
pièges ont produit des faux négatifs avant qu'il soit fiable, et méritent
d'être connus de quiconque écrira un garde SQL statique :

- unionner les migrations au lieu de les rejouer **ignore les `DROP CONSTRAINT`** ;
- un commentaire SQL citant l'ancienne contrainte crée une **correspondance fantôme** ;
- une contrainte anonyme `UNIQUE(...)` dans un `CREATE TABLE` doit être mappée au
  nom généré par PostgreSQL (`<table>_<cols>_key`) pour être reliée à son drop.

Audit des autres `ON CONFLICT` du dépôt : tous valides.

## Corrigé — 6. Course de lecture dans `phase11` (pas un bug produit)

**Symptôme** : `✗ Job retention_purge → done — [{"status":"processing"}]`.

**Ce n'était pas une régression** : la purge avait bien eu lieu, et les quatre
assertions qui la mesurent étaient vertes. Seule la lecture du statut terminal
échouait.

**Cause** : le worker COMMIT le travail métier, **puis** appelle
`jobs_finish_leased()` dans un aller-retour SQL distinct. Entre les deux, la
ligne reste légitimement `processing`. Le test lisait le statut immédiatement
après avoir observé l'**effet** de la purge, supposant que l'effet et le statut
deviennent visibles au même instant.

**Pourquoi maintenant** : la suite était verte sur `baef7b6` et `8c64924`. Plus
les correctifs précédents libèrent de temps machine, plus worker et test
s'exécutent concurremment, et la fenêtre finit par s'ouvrir. Laissée en l'état,
elle aurait produit un échec **intermittent** — le pire type à diagnostiquer.

**Correctif** : attendre l'état terminal, comme le font déjà toutes les autres
suites worker (`phase13`, `21`, `23`, `28`, `36`) ; `phase11` était la seule du
dépôt à lire ce statut sans attendre. `failed` est traité comme terminal : un
vrai échec est signalé immédiatement, jamais masqué en `done`.

## 24/09/2026 — le job redevient rouge : deux causes distinctes

Le job avait été remis au vert le 23/09 (`52e6ef3`). Les runs du 24/09 sur `main`
(`3b8f51b`) puis sur la branche du plan de réparation (`f73c7c0`, `e3728cc`,
`225fead`) sont rouges **pour deux raisons différentes**, qualifiées par les
annotations `check-runs` (méthode ci-dessous — `gh run view --log-failed` et
`gh api …/jobs/<id>/logs` échouent toujours en `EOF`).

| Run | Symptôme observé | Cause | État |
|---|---|---|---|
| `3b8f51b` (main) | gate **terminé**, `rc=1` | H1 dev **et** staging : `Registry pull failed … unauthorized: access to the requested resource is not authorized` — tirage de `postgres:18-alpine` et `quay.io/minio/minio` **avant** tout `docker compose` | **préexistant, environnemental** : le job était vert la veille (`52e6ef3`) et aucun fichier de registre/stack n'a changé. Le runner GitHub n'obtient plus le tirage anonyme. Non reproductible ici (pas de Docker) → **non corrigé**, à traiter côté credentials/miroir |
| `f73c7c0`, `e3728cc`, `225fead` | gate **interrompu AVANT la batterie** : `Gate D interrompu :: … phase26-production-roles.test.mjs (exit 1)` | **régression du lot 1** : le job CI exporte `RATE_LIMIT_DISABLED: 'true'` (raccourci de banc d'essai) ; `phase26` lance les **entrées de production** avec `...process.env` → la garde de configuration refuse le démarrage (« GARDE CONFIG PRODUCTION — RATE_LIMIT_DISABLED ») au lieu de rendre `DATABASE_ROLE_UNSAFE`. 2 tests rouges → **la batterie d'isolation n'a jamais tourné en CI sur ces trois commits** | **corrigé** (voir ci-dessous) |

Conséquence à retenir : un lot peut être vert en local (les suites tournent alors
avec `PRODUCTION_ROLE_TESTS` non défini, et `RATE_LIMIT_DISABLED` n'entre en jeu
que dans les spawns de production) et **rouge en CI** pour une variable
d'environnement du job. C'est exactement le cas ici.

### Correctif — 24/09

- `tests/tenant-isolation/helpers.mjs` : nouvelle constante partagée
  **`PRODUCTION_SPAWN_ENV = { RATE_LIMIT_DISABLED: 'false' }`** — un environnement
  de production ne désactive jamais la limitation de débit.
- Les **cinq** suites qui lançaient une entrée de production avec `...process.env`
  la neutralisent désormais : `phase22`, `phase26`, `phase27`, `phase28`, `phase49`
  (`phase27`/`phase28` seulement en mode gate : `PRODUCTION_ROLE_TESTS=1`).
- **Verrou anti-régression** dans `phase26` : toute suite qui lance
  `dist/main.js` en production sans neutraliser le raccourci fait échouer le gate.
  Mesuré avant/après : **5 fichiers signalés** (contenu de `HEAD`) → **0** après
  correctif.

### Preuve (bac à sable, PG 18.4 réel, sans Docker)

```bash
# Reproduction de la condition CI (le job exporte RATE_LIMIT_DISABLED=true) :
DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
  ALLOW_DATABASE_RESET=1 RATE_LIMIT_DISABLED=true \
  node --test tests/tenant-isolation/phase26-production-roles.test.mjs
# AVANT : # pass 12 / # fail 2  — « Boot exit 1 : GARDE CONFIG PRODUCTION …
#          RATE_LIMIT_DISABLED » et « input did not match /DATABASE_ROLE_UNSAFE/ »
# APRÈS : # pass 15 / # fail 0

# Gate D complet, environnement fidèle au job « database » :
DATABASE_URL=… RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local \
  STORAGE_LOCAL_DIR=/tmp/creche-storage-ci PAYMENT_WEBHOOK_SECRET=phase8-test-secret \
  ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```

**Résultat du gate complet rejoué localement avec cet environnement : `rc=0`,
`72/72 suites vertes`** (phase26 `# pass 15 / # fail 0`, phase22 44 assertions,
phase27 14, phase28 23, phase47 38, phase49 48, phase66 35, phase67 37 ; preuves
H2a–H2l et G1–G5 émises ; sous-gates Docker/Flutter « NOT EXECUTED locally »).

Ce rejeu a une vertu propre : la batterie est allée jusqu'au bout pour la
première fois depuis l'apparition du rouge et elle a **trouvé un défaut dans le
correctif lui-même** — un import oublié dans
`phase22` (`ReferenceError: PRODUCTION_SPAWN_ENV is not defined`, 1 suite rouge
sur 72). Les suites `phase27` (14/0), `phase28` (23/0), `phase47` (38/0) et
`phase49` (48/0) sont vertes en mode rôles de production. Le défaut a été
corrigé puis rejoué seul (`phase22` : 44 assertions ✓), avant le gate complet de
contrôle.

## Lire les échecs CI sur ce dépôt

`gh run view --log-failed`, `gh api .../jobs/<id>/logs` et `gh run download`
échouent (`EOF` / « still in progress »). Seule méthode fiable :

```bash
gh api repos/:owner/:repo/commits/<sha>/check-runs \
  --jq '.check_runs[]|select(.name=="database")|.id'
gh api repos/:owner/:repo/check-runs/<id>/annotations \
  --jq '.[]|.title+" :: "+.message'
```
