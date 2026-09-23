# Job CI « database » — état, corrections et reliquat

_Dernière mise à jour : 23/09/2026 — branche `arena/01a0ca72-cr-chedz` (PR #49)._

## Résumé

Le job `database` était **bloqué 6 h puis annulé**, sans aucun diagnostic
exploitable. Il échoue désormais en ~14 min en nommant précisément ce qui ne va
pas. Trois défauts **préexistants sur `main`** ont été mis au jour ; deux sont
corrigés, **deux suites restent rouges** et sont documentées ici.

Aucun de ces défauts ne vient de la refonte Sérénité : la branche ne modifie que
`apps/api/src/modules/identity` (3 fichiers) et ajoute une garde de contrat
compose. `git diff main...HEAD -- apps/api/src/modules/media
apps/api/src/modules/parents apps/api/src/shared/storage` est **vide**.

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

## Reste rouge — deux suites, cause non identifiée

Ces deux suites échouent sur le même périmètre : **les médias parent**. Elles
n'ont pas été corrigées faute de pouvoir les rejouer (voir plus bas).

### `phase7-parent.api.test.mjs`

```
✗ Parent A reçoit la photo avec URL signée
✗ Préférence désactivée : aucun push en file — file=1
```

L'assertion attend `status === 200 && body.length === 1 && body[0].url` commençant
par `http`. Le second échec (file de notifications non vide alors que la
préférence est désactivée) semble **indépendant** du premier.

### `phase37-parent-revocation.api.test.mjs`

```
✗ authorized: photos: AssertionError [ERR_ASSERTION]
✗ health revoked: photos: AssertionError [ERR_ASSERTION]
```

Ligne concernée : `assert.ok(response.body[0].url.includes('X-Amz-Signature='))`
— `body[0]` est probablement absent (liste vide) plutôt que mal signé.

### Piste écartée

L'hypothèse « `STORAGE_BACKEND: local` empêche la signature S3 » a été **vérifiée
et écartée** : `getSignedUrl` est un calcul local (HMAC), sans appel réseau ni
bucket existant. Reproduit hors CI — l'URL produite contient bien
`X-Amz-Signature=`. La cause est donc en amont : la liste de médias renvoyée est
vide, ce qui pointe vers le filtrage par consentement ou la visibilité parent,
pas vers le stockage.

### Prochaine étape pour qui dispose d'un PostgreSQL

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/creche_test
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
npm run build --workspace @creche/api
bash scripts/run-isolation-suites.sh phase7-parent   # puis phase37
cat /tmp/suite-phase7-parent.api.test.log            # log complet de la suite
```

**Pourquoi ce n'a pas été fait ici** : l'environnement d'agent n'a ni `psql`, ni
`pg_ctl`, ni `postgres`, ni `pg_isready`, ni `docker`. Ces suites exigent un
PostgreSQL réel migré et seedé ; elles ne peuvent pas être rejouées, et
l'API de logs GitHub renvoie `EOF` sur ce dépôt (seules les annotations
`check-runs` sont lisibles). Corriger à l'aveugle un filtrage de consentement —
un mécanisme de protection de données sous loi 25-11 — aurait été plus risqué que
de documenter précisément le symptôme.

## Lire les échecs CI sur ce dépôt

`gh run view --log-failed`, `gh api .../jobs/<id>/logs` et `gh run download`
échouent (`EOF` / « still in progress »). Seule méthode fiable :

```bash
gh api repos/:owner/:repo/commits/<sha>/check-runs \
  --jq '.check_runs[]|select(.name=="database")|.id'
gh api repos/:owner/:repo/check-runs/<id>/annotations \
  --jq '.[]|.title+" :: "+.message'
```
