# Analyse du « Comprehensive Senior Engineering & Security Review Report » — cr-cheDZ

Date d'analyse : 2 octobre 2026
Commit analysé : `0b70d71` (branche `arena/01a0fd65-cr-chedz`, base `main`)
Méthode : confrontation de chaque finding au code, aux migrations, aux workflows CI et aux tests réellement présents.

---

## Verdict global

Ce rapport est **d'une toute autre qualité** que le précédent : il cite des fichiers qui existent presque tous, des numéros de ligne exacts, et ses métriques de schéma sont bonnes. **Mais le défaut principal change de nature** : la plupart des findings décrivent des bugs **réels… déjà corrigés** dans le commit analysé, ou des rustines que le dépôt implémente déjà (parfois plus strictement que ce que le rapport recommande).

| # | Finding | Verdict | Réalité au commit |
|---|---|---|---|
| BUG-001 | Alert Relay : chaîne globale + ledger 5000 | 🟡 **Vrai, mais sévérité surévaluée** | Le code existe tel que décrit. Non corrigé. Le garde `queued>=16 → 429` n'est pas mentionné |
| BUG-002 | Index `organization_id` manquants (077) | ✅ **Exact — déjà corrigé ET déjà gardé en CI** | Migration 077 + `check-tenant-index.mjs` câblé (`ci.yml:98`) |
| BUG-003 | Superuser → RLS contournée | ❌ **Réfuté** | L'assertion de démarrage recommandée **existe déjà** (API + worker) et est plus stricte ; les tests tournent avec rôles de production |
| BUG-004 | Webhook HMAC : rawBody + casse hex | 🟡 **Partiellement vrai** | Comparaison sensible à la casse = vrai. `rawBody: true` est activé → le fallback est défensif, pas une faille |
| BUG-005 | 7 `test.skip` masquant des régressions | ❌ **Réfuté** | **Zéro** `.skip()` dans tout le dépôt ; le gardien `check-e2e-skeletons.mjs` existe et tourne (8 fichiers, 0 squelette) |
| BUG-006 | Volume PG 18 incompatible | ❌ **Réfuté** | Les 3 compose montent `/var/lib/postgresql` (commentaire citant le bug upstream) ; le contrat de test proposé existe déjà |
| BUG-007 | `web_client` absent du DTO invitation | ❌ **Réfuté** | Le champ existe, le cookie est posé, un spec de régression dédié documente ce bug historique |
| BUG-008 | Galerie photos parent toujours vide | ❌ **Réfuté** | `listForParent()` existe et est utilisé ; 1 spec unitaire + 3 suites d'isolation couvrent ce bug historique |
| BUG-009 | Fuite de connexion PG → CI bloquée 6 h | ❌ **Réfuté** | `db.end()` ajouté avec commentaire ; `client-leak-guard.test.mjs` existe ; `timeout-minutes: 90` posé |
| BUG-010 | Trivy : CVE dans les images | ❌ **Réfuté dans ses termes** | Chemins de Dockerfile inexistants ; alpine + purge npm/corepack **déjà faits** ; Trivy **déjà** bloquant en CI |
| BUG-011 | Course de sync sur l'attendance | ❌ **Réfuté** | `INVALID_STATE_TRANSITION` rejette déjà `check_in` sur une session `departed` + verrous `FOR UPDATE` |
| BUG-012 | Effacement 25-11 vs conservation 19-253 | ❌ **Réfuté comme défaut** | `anonymize_child` + purge S3 best-effort + audit : exactement le motif « deux étages » recommandé, déjà implémenté et testé |

**Bilan : 2 findings partiellement valides (BUG-001, BUG-004), 1 exact mais déjà traité (BUG-002), 9 réfutés.**

---

## Détail des vérifications

### BUG-001 — Alert Relay : 🟡 vrai sur le fond, sévérité surévaluée

Le fichier réel est `apps/api/operations/alert-relay.mjs` (150 lignes) — **le rapport cite `infrastructure/alert-relay/alert-relay.mjs`**, chemin inexistant, mais il décrit fidèlement le code :

| Élément cité | Réalité | Verdict |
|---|---|---|
| `let chain = Promise.resolve(), queued = 0, failures = 0` | ligne 98, à l'identique | ✅ |
| `if (Object.keys(ledger).length >= 5000) throw 'ALERT_LEDGER_FULL'` | ligne 107, à l'identique | ✅ |
| `server.requestTimeout = 15000` | ligne 139, à l'identique | ✅ |
| SMTP `socketTimeout: 10000` | ligne 71, à l'identique | ✅ |
| « lignes 95-125 » | la chaîne est ligne 98, le ledger 107 | ≈ |

Deux mécanismes réels :
1. **Sérialisation** : `const work = chain.then(() => processEvents(events)); chain = work.catch(...)` (ligne 98 + 115) — toutes les livraisons sont sérialisées, et un canal lent (Twilio 10 s, SMTP 10 s) bloque les suivantes ; avec `requestTimeout=15000`, un 3ᵉ POST peut effectivement être coupé. Le mécanisme tient.
2. **Ledger** : au-delà de 5 000 empreintes distinctes en 24 h, **toute** alerte est refusée en 503 jusqu'à expiration (TTL 1 h par entrée, purge des entrées > 24 h). Réel.

Ce que le rapport **omet** :
- Le garde de concurrence `if (queued >= 16) → 429` (ligne 128) : la saturation est déjà bornée et signalée proprement.
- La réponse n'est jamais perdue silencieusement : échec → **503 « retry »**, ce qui fait réessayer Alertmanager — le mot « dropped » est inexact.
- 4 tests e2e existent et sont **câblés en CI** (`test-production-roles.mjs:144` exécute `tests/monitoring/alert-relay.test.mjs`), dont un test de concurrence (2 POST simultanés) — mais **aucun** ne couvre le scénario de mise en file ni le plafond de 5 000.
- La remédiation proposée importe `p-limit` : dépendance absente, alors que ce démon est volontairement ultra-léger (`node:http` + nodemailer). À adapter (compteur maison / pool par canal).

**Verdict : finding légitime, à traiter, mais classé « DoS high » alors qu'il s'agit d'une limite de robustesse à volume exceptionnel.**

### BUG-002 — Index tenant : ✅ exact, et déjà gardé

Tout est vérifié : `077_tenant_org_indexes.sql` (28 index, « 32 des 68 tables »), et les chiffres cités (5,8× à 40 orgs, 16,1× à 100 orgs) sont **repris mot pour mot** du fichier. Le gardien `scripts/check-tenant-index.mjs` existe, refuse de rendre un vert sans catalogue (code 2), et **est déjà branché en CI** (`ci.yml:98`), à côté de `tests/perf/bench-tenant-index.mjs`.

Le finding est donc exact **mais son action P1 (« exiger le gardien dans CI ») est déjà satisfaite** — ce rapport décrit un état antérieur au 2026-09-27.

### BUG-003 — Superuser : ❌ réfuté

L'affirmation PostgreSQL est vraie (superuser et `BYPASSRLS` ignorent la RLS), mais les prémisses sur le dépôt sont fausses :

1. **L'assertion de démarrage recommandée existe déjà** — et elle est plus stricte que celle proposée : `assertApplicationDatabaseRole()` (`packages/prod-config/src/database-role.ts`) exige `current_user = 'creche_app'`, `NOSUPERUSER`, `NOBYPASSRLS`, **aucune appartenance de rôle, aucune propriété d'objet, aucun droit DDL** ; sinon `DATABASE_ROLE_UNSAFE` → arrêt du process. Elle est appelée au boot de **l'API** (`shared/database/database.provider.ts:27`) et du **worker** (`apps/worker/src/main.ts:505`), avec spec unitaire (`database-role.spec.ts`) et suite d'isolation (`phase26-production-roles`).
2. **Les tests ne tournent pas en superuser** : `helpers.mjs` utilise `creche_app_test`, créé explicitement `NOBYPASSRLS` (« seul moyen de prouver que la RLS protège réellement »). En CI (`GITHUB_ACTIONS=true`), `run-isolation-suites.sh` **délègue au Gate D** (`scripts/test-production-roles.mjs`, `PRODUCTION_ROLE_TESTS: '1'`) qui rejoue la batterie avec les **rôles et grants de production réels** (`creche_app` issu de `roles.sql`).
3. Le seul point exact : `schema-check.mjs` se connecte par défaut avec `DATABASE_URL` = `postgres` en CI (`ci.yml:38`, le rapport cite la ligne 42 ; la construction du client est ligne 53). Mais `schema-check` est un **contrôle structurel de catalogue** (RLS activée/forcée, `WITH CHECK`, contraintes, dérive des migrations) — le faire en superuser est normal et nécessaire. Le contrôle comportemental RLS est une **étape CI séparée** nommée « rls-behavior-check (rôle NOBYPASSRLS) » (`ci.yml:88`). La répartition est explicite dans le workflow.

**Verdict : le risque décrit n'existe pas dans ce dépôt ; l'action P0 n° 2 est déjà implémentée.**

### BUG-004 — Webhook HMAC : 🟡 le plus défendable

Code réel (`billing.controller.ts:203-211`), conforme à la citation :
- ligne 203 : `const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))` ✅
- ligne 209 : `const provided = Buffer.from(signature)` puis `timingSafeEqual` → **une signature hex en MAJUSCULES est rejetée** alors qu'elle est valide ✅ **vrai bug de robustesse**

Les réserves :
- « JSON.stringify non déterministe / middleware réordonné » : **`rawBody: true` est bien activé** (`app.factory.ts:19`), donc `req.rawBody` est peuplé par Nest pour tout corps JSON ; le fallback est du code défensif quasi mort. Il ne peut pas *accepter* un corps falsifié (l'HMAC porterait sur une re-sérialisation → 401) : la direction d'erreur est **fail-closed**, contrairement à ce que suggère « malformed bodies might pass unexpected structures ».
- « Pas de rate limiting sur l'endpoint public » : vrai au niveau applicatif (aucun `@RateLimit` sur cette route ; 11 routes en ont). Mais nginx applique un quota global api (30 r/m, documenté dans `rate-limit.guard.ts`) et l'endpoint est **idempotent** par `external_reference` (`billing_webhook_apply`) : le « replay amplification » n'a pas d'effet métier.

**Verdict : correctif légitime et quasi gratuit (normaliser en minuscules, refuser l'absence de `rawBody`) ; impact réel « Medium » seulement si un fournisseur envoie de l'hex majuscule.**

### BUG-005 — E2E skippés : ❌ réfuté

- `grep -rn "\.skip(\|\.fixme"` sur `tests/`, `apps/`, `packages/` → **1 seul hit**, sans rapport (`requests.skip(1)` en Dart).
- Les deux specs citées existent et sont **actives** (`billing-overdue-flow.spec.ts` : 281 lignes ; `payroll-finalize-lock.spec.ts` : 167 lignes).
- `node scripts/check-e2e-skeletons.mjs` s'exécute et affiche : **« ✓ Specs e2e : 8 fichier(s), aucun squelette, codes et endpoints réels. »** Il est branché en CI (`ci.yml:241`) et va **plus loin** que le script proposé en remédiation (il vérifie aussi que les codes d'erreur et les routes cités existent).
- Le rapport reprend un incident **historique** (deux specs squelettes, PR #47/#51) déjà corrigé le 2026-09-27 ; « 54 % de la couverture E2E inactive » n'est adossé à aucun calcul.

### BUG-006 — Volume PostgreSQL 18 : ❌ réfuté

Les trois compose (`dev`, `staging`, `prod`) montent déjà `postgres_*_data:/var/lib/postgresql`, avec un commentaire citant `docker-library/postgres#1259` et l'avertissement exact repris par le rapport (« Monter l'ancien chemin `/var/lib/postgresql/data` fait REFUSER le démarrage »). Le test proposé en remédiation — `tests/tenant-isolation/production-compose-contract.test.mjs` — **existe déjà**. Détail : l'exemple « corrigé » du rapport ajoute `PGDATA: /var/lib/postgresql/18/docker` en variable d'environnement, ce qui est inutile (l'image le définit elle-même) et source de confusion.

### BUG-007 — `web_client` : ❌ réfuté

`AcceptInvitationDto` contient bien `@IsOptional() @IsBoolean() web_client?: boolean` (`dto/auth.dto.ts:150-151`) — le fichier cité `accept-invitation.dto.ts` n'existe pas. Le contrôleur pose le cookie (`auth.controller.ts:145-147`). Un spec dédié (`accept-invitation.spec.ts`) **documente précisément ce bug historique** : « Ce champ manquait alors qu'admin-web l'envoie déjà : … 400 "property web_client should not exist" ». Corrigé, testé.

### BUG-008 — Photos parent : ❌ réfuté

`ParentsService.photos()` appelle `this.media.listForParent(childId)` (`parents.service.ts:130`) et non `media.list()`. `parent-photos.spec.ts` s'ouvre sur : « la liste des photos renvoyée aux parents était TOUJOURS vide » — c'est un test de régression de ce bug, referençant les 3 suites d'isolation (phase7, phase37, phase41) qui échouaient dessus. Corrigé, testé.

### BUG-009 — Fuite de connexion CI : ❌ réfuté

`phase62-payroll-finalized-lock.pg.test.mjs` ferme désormais le client d'amorçage (`await db.end()`, ligne 215) avec un commentaire expliquant exactement le symptôme (« la suite se terminait sans jamais rendre la main »). Le gardien proposé — `client-leak-guard.test.mjs` — **existe déjà**, et le job CI porte `timeout-minutes: 90` (la valeur recommandée). Corrigé, gardé.

### BUG-010 — Trivy : ❌ réfuté dans ses termes

- Chemins cités **inexistants** : `infrastructure/docker/Dockerfile.api|worker|web` (les vrais sont `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/admin-web/Dockerfile` ; il n'existe pas de `Dockerfile.web`).
- La remédiation recommandée est **déjà en place** : runtime `node:22.23.3-alpine3.24` et `RUN rm -rf /usr/local/lib/node_modules/npm …/corepack /opt/yarn-v*` (`apps/api/Dockerfile:12,26`).
- Trivy est **déjà** un gate bloquant : `aquasecurity/trivy-action`, `scanners: vuln`, `severity: CRITICAL,HIGH`, `exit-code: '1'` (`docker.yml:52-58`), avec résumé lisible (`scripts/summarize-trivy.mjs`). CodeQL est également configuré (`codeql.yml`). L'action P1 « activer Trivy/CodeQL comme gates » est donc déjà faite.
- Les CVE listées sont invérifiables (run `36376953373`) et **incohérentes** : paquets `perl-base` d'une base *Debian 12.15* pour des images dont le runtime est *Alpine* ; `brace-expansion` du npm embarqué alors que npm est précisément purgé du runtime.

### BUG-011 — Course de synchronisation attendance : ❌ réfuté

Le garde recommandé (« une session `departed` ne doit pas repasser `present` ») **est déjà le comportement du code** :

- `applyCheckIn` : `if (session.status === 'present' || session.status === 'departed') return rejected('INVALID_STATE_TRANSITION', …)` (`attendance.service.ts:164-166`).
- `applyCheckOut` : exige `status === 'present'` (ligne 209-210).
- `sessionForUpdate` verrouille la ligne (`… FOR UPDATE`, ligne 349) et `childOfTenant` verrouille la ligne enfant (ligne 340) pour sérialiser même la création de première session entre HTTP et sync.
- Les corrections passent par `baseVersion` + `VERSION_MISMATCH` (conflit renvoyé, pas d'écrasement).

Autrement dit : le scénario de reproduction du rapport (tablette A hors ligne, tablette B clôt la journée, A synchronise ensuite) aboutit à un **rejet `INVALID_STATE_TRANSITION`**, pas à une régression vers `present`. La seule nuance (légitime mais mineure) : le rejet est journalisé en `sync_operations`, il n'écrit pas de ligne d'audit « conflit » dédiée comme le suggère l'exemple.

### BUG-012 — Effacement 25-11 vs conservation 19-253 : ❌ réfuté comme défaut

Le rapport présente comme un risque à corriger ce que le dépôt a **déjà arbitré et implémenté** : `anonymize_child()` (migration 067) est transactionnelle, fail-closed tenant (`app_tenant_id()`), idempotente, exige un acteur **et** un motif, refuse un enfant encore actif, puis neutralise enfant / tuteurs exclusifs / comptes parents / sessions / notifications et **retourne les clés de stockage** ; `privacy.service.ts` purge ensuite S3 hors transaction, **remonte les échecs** (`media_purge.failed`) et audite — le commentaire est explicite : « jamais de faux "purgé" ». Le test `phase56b-anonymize-child.api.test.mjs` vérifie les deux cas (MinIO indisponible → `purged: 0`, `failed: [clé]`).

Erreurs factuelles : la signature réelle est `anonymize_child(p_child_id, p_actor_id, p_reason)` — l'exemple « corrigé » du rapport (`p_org_id, p_child_id, p_reason`) est faux (le tenant vient du contexte de session, l'acteur est requis).

---

## Vérification des métriques et de la stack

| Affirmation | Réalité | Verdict |
|---|---|---|
| « 77 immutable SQL migrations » | 77 fichiers | ✅ |
| « 75 tables » | 75 `CREATE TABLE` distincts | ✅ |
| « 74 isolation test suites » | 74 suites + garde RLS (75 entrées, CI) | ✅ |
| « 64 RLS policies » | 69 `CREATE POLICY` | ≈ |
| « 199 API routes » | inventaire CI = 198 | ≈ |
| NestJS 11 / React 19 / PostgreSQL 18 / Flutter + Drift 2.20 | confirmé (`@nestjs/core ^11`, `react ^19.2`, `postgres:18-alpine`, `drift ^2.20`) | ✅ |
| « **722 files, ~79,700 lines of code** » | **811 fichiers suivis ; 69 538 lignes** (.ts/.dart/.sql/.mjs/.js) | ❌ |

Le chiffre de volume est **le seul repris à l'identique du rapport précédent** — c'est le marqueur d'une origine commune, alors que les métriques de schéma sont, elles, exactes.

## Section « Missing Test Coverage » : 2 sur 5 sont déjà couvertes

| Réf. | Verdict | Preuve |
|---|---|---|
| MTC-001 (matrice de conflits / dérive d'horloge ±30 min) | 🟡 **gap réel** | verrous + `VERSION_MISMATCH` existent, mais aucune simulation multi-tablettes désynchronisées |
| MTC-002 (MinIO indisponible pendant l'anonymisation) | ❌ **déjà couvert** | `phase56b` : `media_purge.purged = 0`, `failed = [clé]`, audit `media_purge` — pas de faux « purgé » |
| MTC-003 (rafale de webhooks concurrents) | 🟡 **gap partiel** | `phase24-late-webhook` couvre le webhook tardif, pas une rafale concurrente ; l'idempotence par `external_reference` et le verrouillage limitent le risque |
| MTC-004 (épuisement du pool) | 🟡 **partiellement couvert** | `tests/load/capacity-bench.mjs` : rôle NOBYPASSRLS, pool 10, pointages et sync concurrents, 0 réponse 5xx |
| MTC-005 (race de refresh token parent) | ❌ **déjà couvert** | `parent-session-contract.test.mjs` : point d'entrée unique + single-flight par futur partagé, testés |

## Plan de tests (section 4) : deux seuils inventés

- §4.5 « capacité : `tests/load/capacity-bench.mjs` … p95 < 50 ms sous 200 requêtes sync concurrentes » : le bench réel vise **12 structures × 2 tablettes × 20 opérations** avec des budgets p95 de **250 ms (check-in) à 3 000 ms (login / sync push)**, calibrés comme cliquet anti-régression. Le seuil « 50 ms / 200 requêtes » ne correspond à rien.
- §4.2 « immuabilité financière : UPDATE/DELETE rejetés avec SQLSTATE **42501** » : le DELETE lève bien `42501`, mais la garde d'immuabilité UPDATE lève **`P0001`** (`INVOICE_IMMUTABLE` / `PAYMENT_IMMUTABLE`, migration 064). Un test écrit sur cet attendu échouerait.

## Plan d'action (section 5) : les P0 sont déjà faits — sauf un

| Action recommandée | État réel |
|---|---|
| P0 — Assertion « non-superuser » au démarrage | ✅ **déjà implémentée** (et plus stricte) : `assertApplicationDatabaseRole`, API + worker |
| P0 — Durcir le webhook SATIM (rawBody + casse) | 🟡 **à faire** : la normalisation de casse est un vrai correctif ; `rawBody: true` est déjà actif |
| P0 — Alert Relay (concurrence bornée + ledger) | 🟡 **à faire** (seul P0 restant non traité) |
| P1 — Gardien d'index tenant en CI | ✅ déjà branché (`ci.yml:98`) |
| P1 — Trivy / CodeQL bloquants | ✅ déjà en place (`docker.yml`, `codeql.yml`) |
| P1 — Garde d'état terminal attendance | ✅ déjà en place (`INVALID_STATE_TRANSITION` + `FOR UPDATE`) |
| P2 — E2E sans skip | ✅ déjà en place (0 skip, gardien actif) |
| P2 — File de repli pour les purges média | 🟡 partiel : l'échec est remonté et audité (pas de file de retry) — évolution possible, non bloquante |
| P3 — OpenAPI généré / k6 en staging | 🟡 partiel : `sync.k6.js` existe mais n'est pas exécuté ; contrat OpenAPI vérifié par `openapi-contract.test.mjs` |

---

## Conclusion

**Ce rapport est utilisable, à condition de le décaler dans le temps.** Ses findings BUG-002, 005, 006, 007, 008, 009 décrivent des défauts **réels qui ont déjà été corrigés et gardés** (souvent avec un test de régression nommant explicitement le bug d'origine — `parent-photos.spec.ts`, `accept-invitation.spec.ts`, `client-leak-guard.test.mjs`, `check-e2e-skeletons.mjs`, `production-compose-contract.test.mjs`). BUG-003, 010 et 011 sont réfutés par le code actuel ; BUG-012 décrit comme manquante une implémentation existante et testée.

**Ce qui reste réellement actionnable, par ordre de valeur :**

1. **BUG-004 (webhook)** — normaliser la signature hex en minuscules et refuser une requête sans `rawBody` : correctif de quelques lignes, effet immédiat sur l'intégration SATIM. *Priorité : moyenne-haute, coût : minutes.*
2. **BUG-001 (alert-relay)** — borner la concurrence (pool maison, sans ajouter `p-limit`), remplacer le plafond dur du ledger par une éviction des plus anciennes, et ajouter le test de non-blocage proposé (en tenant compte du `429` existant). *Priorité : moyenne, coût : 0,5–1 j.*
3. **MTC-001 / MTC-003** — deux gaps de tests qui valent la peine : matrice de conflits multi-appareils avec dérive d'horloge, et rafale de webhooks concurrents. *Coût : 0,5 j chacun.*
4. **BUG-012 volet exploitation** — la purge média est best-effort ; une file de retry (job worker) supprimerait le seul angle mort restant signalé (photos résiduelles si MinIO est indisponible au moment de l'anonymisation). *Coût : 0,5 j.*

Point de méthode, comme pour le rapport précédent : ce document gagne à être relu **avec le SHA du commit d'audit**. Six de ses douze findings se réfutent d'eux-mêmes par un simple `git log` — les correctifs sont datés du 2026-09-24 au 2026-09-27 et le commit analysé est postérieur.
