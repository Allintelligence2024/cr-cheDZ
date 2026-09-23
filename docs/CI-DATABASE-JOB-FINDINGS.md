# Job CI « database » — état, corrections et reliquat

_Dernière mise à jour : 23/09/2026 — branche `arena/01a0ca72-cr-chedz` (PR #49)._

## Résumé

Le job `database` était **bloqué 6 h puis annulé**, sans aucun diagnostic
exploitable. Il échoue désormais en ~14 min en nommant précisément ce qui ne va
pas. Cinq défauts **préexistants sur `main`** ont été mis au jour ; quatre sont
corrigés, **une assertion reste rouge** et est documentée ici.

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

## Reste ouvert — une assertion

### `phase7-parent` : `Préférence désactivée : aucun push en file — file=1`

Un `check_in` met un push en file alors que le parent a désactivé
`notification_preferences` pour cet événement. La logique de
`notifications.service.ts` paraît pourtant correcte (`if (!pref || pref.is_enabled)`),
l'écriture et la lecture utilisent les mêmes colonnes
(`organization_id, user_id, channel='push', event_type`), et le test cible bien
le même utilisateur. L'hypothèse la plus probable est que la préférence n'est pas
trouvée au moment de la lecture — contexte de tenant, ordre des opérations, ou
transaction distincte — mais cela demande d'observer la base pendant l'exécution.

**Non corrigé délibérément** : sans PostgreSQL pour reproduire, toute
modification de la logique de notification serait une supposition. Le symptôme
est isolé et documenté plutôt que masqué.

### Comment reprendre

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/creche_test
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
npm run build --workspace @creche/api
bash scripts/run-isolation-suites.sh phase7-parent
cat /tmp/suite-phase7-parent.api.test.log
```

**Pourquoi ce n'a pas été fait ici** : l'environnement d'agent n'a ni `psql`, ni
`pg_ctl`, ni `postgres`, ni `pg_isready`, ni `docker`.

## Lire les échecs CI sur ce dépôt

`gh run view --log-failed`, `gh api .../jobs/<id>/logs` et `gh run download`
échouent (`EOF` / « still in progress »). Seule méthode fiable :

```bash
gh api repos/:owner/:repo/commits/<sha>/check-runs \
  --jq '.check_runs[]|select(.name=="database")|.id'
gh api repos/:owner/:repo/check-runs/<id>/annotations \
  --jq '.[]|.title+" :: "+.message'
```
