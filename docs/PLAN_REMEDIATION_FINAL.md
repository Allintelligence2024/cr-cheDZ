# PLAN DE REMÉDIATION FINAL — cr-cheDZ

**Accompagnement de** `RAPPORT_ANALYSE_CR-CHE-DZ.md` (analyse A→Z, 10 tranches) · **21 septembre 2026**
**Objectif du plan :** un clone frais devient un environnement **local fonctionnel et testable en < 30 min** (porte G-local), puis **testable avec des données réalistes sans faille de sécurité** (porte G-sec), puis **prêt staging → prod** (porte G-beyond).

Méthode : chaque item = problème (ID + source), changement exact (fichier:ligne), preuve de vérification, effort, dépendances. Les lignes citées ont été re-vérifiées dans le repo le 2026-09-21.

---

# 1. CONFRONTATION DES DEUX RAPPORTS

Le second rapport (l'« autre agent ») a été reléché **claim par claim** contre le repo. Verdict d'avance : c'est une carte plausible mais non fiable. Elle invente une version PostgreSQL inexistante, des noms de rôles absents, et des compteurs de lignes gonflés de 60 à 115 fois. Elle rate en revanche 100 % des vrais risques P0/P1 identifiés dans mon rapport. On la garde pour 5 points mineurs, vérifiés.

## 1.1 Ce que l'autre rapport a ÉCRIT FAUX (preuves vérifiées aujourd'hui)

| # | Claim de l'autre rapport | Réalité vérifiée | Gravité |
|---|---|---|---|
| E1 | « `postgres:9.6` en production — CRITIQUE n°1, EOL depuis 2021 » | **Aucun 9.6 nulle part.** `postgres:16-alpine` : `docker-compose.dev.yml:13`, `docker-compose.prod.yml:31` **et** `:276` (conteneur backup), `docker-compose.staging.yml:9`. CI : `postgres:18` avec le commentaire explicite `ci.yml:2` — « 18.4.0-beta.17 en local ; docker-library/postgres:18 en CI — **JAMAIS 16/17** ». Le vrai problème (F1) est l'**inverse** : le schéma exige PG18 (`NULLS NOT DISTINCT` dans `migrations/003_users_and_security.sql`) alors que la prod documentée est sur 16. Le « fix » qu'il propose (9.6 → 16+) aurait **verrouillé la config cassée**. | **Faux + direction inversée** |
| E2 | Rôles DB : `crche_admin, crche_api, crche_worker, crche_readonly, crche_backup` | `infrastructure/database/roles.sql:7,10` : **deux** rôles — `creche_migrator LOGIN` et `creche_app LOGIN`. Aucun `crche_*`. Hallucination de noms (et d'orthographe). | Faux |
| E3 | « aucun RUNBOOK visible » → recommande d'en créer un | **31 runbooks** dans `docs/` (BACKUP-RUNBOOK, PHASE_D_ROLES_RUNBOOK, PHASE_E_WORKER_RUNBOOK, CI-RESTORE, OPERATIONS-SECRETS, HANDOFF…). Ce qui manque n'est pas les runbooks : c'est un **index/ordre** de lecture. | Faux |
| E4 | Volume de scripts « > 200 000 lignes » ; `check-rls-usage.mjs` = 13 944 L ; `test-production-roles.mjs` = 23 183 L ; `capacity-bench.mjs` = 13 307 L ; `mvp-bench.mjs` = 10 207 L ; `seed-pilot.mjs` = 7 813 L ; `migrate.mjs` = 5 935 L ; `backup.sh` = 3 055 L | Réel (`wc -l`) : **304 / 208 / 208 / 176 / 143 / 137 / 69** lignes. `scripts/` entier = **3 283 lignes**. Les chiffres de l'autre rapport sont ses **octets** lus comme lignes (ex. `capacity-bench.mjs` ≈ 13,3 Ko). Repo total : **≈ 57 081 lignes** de fichiers code/config (ts/tsx/dart/sql/mjs/sh/yml, sans node_modules). | **Gonflé ×60–115** |
| E5 | Services prod : « api (build worker) », nginx, backup, prometheus, grafana, alertmanager | Réel : **15 services** — nginx, postgres, **minio**, **bootstrap-roles**, **migrate**, api, worker, admin-web, support-console, prometheus, alertmanager, **alert-relay**, **postgres-exporter**, grafana, backup. Il en rate 5, et confond api/worker. | Faux / incomplet |
| E6 | Alertmanager « canal de notification non spécifié » | `alertmanager.yml` : route → receiver `operations` → **webhook `http://alert-relay:8091/alerts`** (token Bearer via docker secret). Le service `alert-relay` (`docker-compose.prod.yml:220-248`) relaie vers `ALERT_CHANNELS=local,email,sms,whatsapp` (SMTP + Twilio). Le vrai gap : les **credentials** (`ALERT_SMTP_*`, `ALERT_EMAIL_TO`…) sont vides par défaut. C'est du config, pas du design manquant. | Faux (gap rétréci) |
| E7 | Rôles applicatifs « admin, director, staff, parent » + RBAC | `seeds/003_roles_permissions.sql` : **7 rôles système** — `super_admin, director, educator, accountant, receptionist, parent_primary, parent_secondary` + table `permissions (resource, action)`. Le RBAC granulaire **existe bien** (point juste), mais les noms cités sont faux. | Partiellement faux |
| E8 | `admin-web` = « admin + parents + staff console » | Trois apps distinctes : `admin-web` (console admin, React), `staff-mobile` (Flutter), `parent-mobile` (Flutter), + `support-console` (React, prod uniquement). | Faux |
| E9 | Compose dev : « PostgreSQL, Redis, API, admin-web, support-console » | Compose dev réel : postgres, minio, bootstrap-roles, migrate, api, worker, admin-web. **Pas de Redis** (nulle part dans le projet), **pas de support-console en dev**. | Faux |
| E10 | Extrait de politique RLS « typique » avec `current_setting('app.current_user_id')` | Le GUC réel est **`app_tenant_id`** avec `app_tenant_id()` fail-closed (RAISE si non configuré — migration 018, le vrai bug GUC « '' » documenté). L'extrait est inventé, pas du code du repo. Ne pas s'en servir de référence. | Illustre, pas du code |

## 1.2 Ce que l'autre rapport a JUSTE (conservé, re-vérifié)

| ID | Point | Vérification |
|---|---|---|
| **G1** | Gap E2E **web** sur les flux métier critiques (facturation, paie, absences, sync) | Juste mais **exagéré** : 5 suites Playwright existent (login, session-refresh, invitation, director-flow, export-download) ET la couche DB est couverte par `tests/tenant-isolation/` (15 284 lignes : phase8-billing, phase57-59 dont `contracts-enrollment-schedule`, phase60-satim…). Le vrai trou : **pas de E2E UI** sur billing/payroll/absences. |
| **G2** | Version Flutter non épinglée | Juste : `flutter.yml` utilise `subosito/flutter-action@v2` avec `channel: stable` **sans `flutter-version`** → CI flottante. Les docs du projet citent **Flutter 3.47.1** (`docs/CURSOR-FINAL-MISSIONS.md`). |
| **G3** | Audit des seeds (données réelles vs synthétiques) | Légitime, mais à l'échelle réelle : `seed.mjs` (36 L) = seeds SQL de référence **sans aucune donnée d'organisation** ; `seed-pilot.mjs` (**143 L**, pas 7 813) se déclare « DONNÉES EXCLUSIFEMENT SYNTHÉTIQUES » avec `PILOT_PASSWORD` env. L'audit = un scan de patterns (téléphones/emails/NIN) en 30 min, pas une mission. |
| **G4** | Maintenabilité des scripts de vérification | Réelle à petite échelle (3,3 k lignes, pas 200 k) : manque surtout **l'ordre d'exécution et la doc** des 6 `check-*`/`test-*` (il existe `scripts/run-isolation-suites.sh` qui fait déjà partie du boulot). |
| **G5** | Config d'alerting incomplète | Réduit à : remplir les credentials `ALERT_SMTP_*`/Twilio + un test d'alerte synthétique (voir S3). |

## 1.3 Ce que l'autre rapport a MANQUÉ (l'essentiel)

Aucun des 3 vrais bloquants du projet n'apparaît dans son rapport :

- **F1 (P0)** le mismatch PG16/PG18 — il a « vu » PostgreSQL et a inventé un 9.6 à la place ;
- **F2 (P1)** module **enrollment** sans aucun contrôle de rôle : tout utilisateur authentifié du tenant, **y compris un parent**, peut lister les familles en attente (PII : noms/nés dechildren, tuteur, tél, email), offrir un place et décider (crée un enfant `pre_registered`) ;
- **F3 (P1)** MinIO prod `ports: "9000:9000"` (ligne 52, avec le commentaire même « interne au VPS — jamais exposé publiquement ») → S3 de médias **exposé sur 0.0.0.0**.

Et en plus : F4 (l'anonymisation d'un enfant détruit le compte staff d'un parent-employé, aucun guard SQL ni app), F5 (`/support/` servi publiquement par nginx), F9 (`.env.prod.example` **sans `TOTP_ENCRYPTION_KEY`** alors que le boot prod l'exige → refus de boot garanti depuis l'exemple), F10 (worker unique séquentiel, un export de 120 s bloque tout), F12 (tokens web en `localStorage`), F14 (sync-contract en état « Do not deploy this intermediate lot » alors que staff-mobile consomme déjà le client généré), F15 (repo = **1 seul commit** `e3355ec`), F16 (enrollment + staff_shifts exposés en HTTP **sans aucune UI**).

**Verdict sur le rapport :** ne pas le citer comme source, ne pas le diffuser tel quel (le 9.6 et les 23 000 lignes vont tromper n'importe qui). Ses 5 points justes (G1–G5) sont intégrés ci-dessous avec leurs vraies priorités.

## 1.4 Correction de MON rapport (honnêteté oblige)

- **Volume** : mon rapport disait « ~35 k LOC / 641 fichiers ». Vérifié aujourd'hui : **≈ 57 081 lignes** de fichiers code/config (sans node_modules/.git) — `tests/` = 16 203 L dont tenant-isolation 15 284 L ; `apps/api` ≈ 16 150 L ; `scripts/` = 3 283 L. Le 35 k ne comptait qu'une partie. Les **constats ne changent pas** ; le volume du projet est plus grand, donc la charge de test est réelle (61 suites d'isolation — ce qui explique aussi pourquoi la suite a tenu F1 : CI sur PG18, prod doc sur PG16).
- Tout le reste (F1–F34) tient, et F1/F3/F9 viennent d'être re-confirmées ligne à ligne ce jour.

---

# 2. INVENTAIRE CONSOLIDÉ (union des deux rapports)

| ID | Problème | Prio | Source | Phase |
|----|----------|------|--------|-------|
| F1 | PG : schéma 18 / compose+README+drill 16 → la prod documentée **ne peut pas appliquer le schéma** | **P0** | mon rapp. (re-vérifié §1.1-E1) | 1 |
| F9 | `.env.prod.example` sans `TOTP_ENCRYPTION_KEY` (obligatoire au boot prod) | **P0** | mon rapp. (re-vérifié : présent dans `.env.example:72`, absent du prod) | 1 |
| F3 | MinIO prod sur `0.0.0.0:9000` (S3 médias exposé) | **P1** | mon rapp. (re-vérifié `prod.yml:52`) | 1+2 |
| F2 | enrollment : 0 `@Roles`, 0 check service → un parent décide des places | **P1** | mon rapp. | 2 |
| F4 | `fn_anonymize_child` : aucun guard membership staff → détruit le compte d'un parent-employé | P2↑ | mon rapp. | 2 |
| F5 | `/support/` servi publiquement (nginx se contente de « recommander » VPN/IP) | P2↑ | mon rapp. | 2 |
| F6 | Backup local-only (GPG, 7 j), pas d'offsite, rétention non justifiée | P2 | mon rapp. | 3 |
| F7 | `memberships.room_ids` collecté, **appliqué nulle part** (médias listés/downloadables par tout le staff) | P2 | mon rapp. | 3 |
| F8 | Retention : `sync_changelog`/`sync_operations`/`sync_inbox`/`sync_queue` jamais purgés | P2 | mon rapp. | 3 |
| F10 | Worker unique séquentiel (120 s d'export bloque PDF/expiration/purge) ; compose = 1 replica | P2 | mon rapp. | 3 |
| F11 | `RateLimitService.sweep()` jamais appelé → Map mémoire sans borne | P2 | mon rapp. | 3 |
| F12 | Tokens web en `localStorage` (admin-web, support-console) — les mobiles Flutter font bien (flutter_secure_storage) | P2 | mon rapp. | 3 |
| F13 | `payroll_runs` finalisé modifiable par SQL (asymétrie vs C04 billing) | P2 | mon rapp. | 3 |
| F14 | sync-contract README « F3/F4 open — Do not deploy » ; staff-mobile consomme déjà le client généré | P2 | mon rapp. | 3 |
| F15 | Repo = 1 commit (`e3355ec`) : pas d'historique, de blame, de revert | P2 | mon rapp. | 0 |
| F16 | enrollment + staff_shifts : routes HTTP sans aucune UI admin | P2 | mon rapp. | 3 |
| F17–F34 | 18 points P3 (détail : mon rapport §4) : ROWTYPE 025, `deleted_at` manquante sur `EXISTS(guardians)`, total invoice ≠ SUM(lines), `partially_paid` éditable, `invoices_mark_overdue` SECURITY INVOKER, SMTP dans la tx (~47 s), impersonation sans `roles[]`, audit void fire-and-forget, nginx 5r/m vs CGNAT, `national_id` en clair au repos, commentaire stale ci.yml, `pnpm-workspace.yaml` orphelin, clé FCM legacy, `notification_preferences` sans scope org, `decide(accepted)` crée un enfant sans lien `child_guardians`, `tests/{financial,e2e,sync}` = READMEs, branch protection = check `database` seul, `run_pg.mjs` /tmp persistant, index `children(org,site)` manquant, `KEEP_DAYS=7` non justifié | P3 | mon rapp. | 3-4 |
| **G1** | Gap E2E **UI** sur billing/payroll/absences/sync (5 flux Playwright seulement) | P2 | autre rapp. (vérifié) | 4 |
| **G2** | Flutter CI flottant (`channel: stable`, pas de `flutter-version`) alors que le projet vise 3.47.1 | P3 | autre rapp. (vérifié) | 4 |
| **G3** | Audit patterns de données réelles dans les seeds (30 min) | P3 | autre rapp. (vérifié) | 4 |
| **G4** | Scripts `check-*`/`test-*` : ordre d'exécution + doc manquante (3,3 k lignes réelles, pas 200 k) | P3 | autre rapp. (vérifié) | 4 |
| **G5** | Credentials d'alerting vides par défaut (SMTP/Twilio) | P3 | autre rapp. (vérifié) | 4 |

**Priorités réordonnées** : les deux P1 de l'autre rapport (« scripts excessifs », « seed lourd ») tombent en P3 à l'échelle réelle. Les P1 réels (F2, F3) sont ceux de mon rapport.

---

# 3. LE PLAN DE REMÉDIATION

**Principe d'exécution** : 4 phases, 3 portes d'acceptation. Une phase ne se referme que sur sa porte verte. Les items d'une même phase sont parallélisables sauf dépendance marquée.

## PHASE 0 — Baseline & hygiène (prérequis, 2 h)

| ID | Action | Détail | Vérification |
|----|--------|--------|--------------|
| P0-1 | **Commettre l'état actuel** (F15) | `git add -A && git commit -m "chore: baseline avant remédiation"` sur la branche de travail. Un repo de 57 k lignes en 1 commit n'a ni revert ni blame — c'est une dette qui croît à chaque fix. | `git log` ≥ 2 commits |
| P0-2 | Corriger les volumes dans les deux rapports | Ce document (§1.4) remplace le « ~35 k » ; le rapport de l'autre agent est marqué **non fiable** (E1–E10) avant toute diffusion. | — |
| P0-3 | Documenter la toolchain (README) | Docker + compose plugin ; **Node ≥ 20** (`engines` du root) pour les scripts hôte ; **Flutter 3.47.1** (docs projet, à épingler — G2/S2) ; k6 optionnel (tests de charge). | section README « Prérequis » |

## PHASE 1 — LOCAL P0 : « ça marche » (objectif : clone frais → testable en < 30 min)

| ID | Action | Changement exact | Vérification | Effort |
|----|--------|------------------|--------------|--------|
| **R1** (F1, P0) | **Aligner PostgreSQL sur 18 partout** | ① `docker-compose.dev.yml:13` `postgres:16-alpine` → `postgres:18-alpine` ; ② `docker-compose.prod.yml:31` **et** `:276` (conteneur backup) → `18-alpine` ; ③ `docker-compose.staging.yml:9` → `18-alpine` ; ④ `README.md:12` « PostgreSQL 16 » → 18 ; ⑤ `ci.yml` job `backup-drill` (L74-79) : source du drill `postgres:16` → `postgres:18` — **le drill simule aujourd'hui volontairement la prod documentée (commentaire explicite « Source en postgres:16 : version de docker-compose.prod.yml »)** ; après l'alignement il devra simuler la prod réelle. ⚠️ Piège connu et documenté (`docs/PHASE_D_ROLES_RUNBOOK.md:82`) : le format de volume PG18 ≠ PG16 → base dev existante : volume propre ou `npm run db:reset` ; prod existante : `pg_dump` → cluster 18 neuf (à documenter dans BACKUP-RUNBOOK). | Sur PG18 neuf : les **70 migrations** s'appliquent sans erreur (`npm run db:migrate`) → `npm run db:check-schema` → `npm run db:check-rls` → **suites tenant-isolation phase3→60 vertes** → CI `database` + `backup-drill` verts | 0,5 j |
| **R2** (F9, P0) | **Clé TOTP dans l'exemple prod** | `.env.prod.example` : ajouter `TOTP_ENCRYPTION_KEY=` (présent dans `.env.example:72`, absent du prod) + le passage en commentaire « requis : le boot prod refuse sans elle ». Anti-régression : croiser la liste des variables requises par `packages/prod-config` (boot guards) avec les deux `.example` — en ajouter un `check:env-example` (script 20 lignes). | Boot d'api avec `.env` copié du `.env.prod.example` rempli → succès (pas de refus G5) ; `check:env-example` vert | 1 h |
| **R3** (F3) | **MinIO hors 0.0.0.0** | `docker-compose.prod.yml:52` : `"9000:9000"` → `"127.0.0.1:9000:9000"` (le dev fait déjà bien `"127.0.0.1:…"` à `dev.yml:35`). L'API parle à MinIO via le réseau compose (`S3_ENDPOINT=http://minio:9000`) : le port host n'est utile qu'au debug VPS. | `docker compose ps` + `ss -ltnp` sur le VPS : 9000 uniquement sur lo | 10 min |
| **R4** | **Recette de démarrage local, testée** | Écrire `docs/LOCAL-RUN.md` (ou compléter PHASE_H1_DEV_RUNBOOK) avec la séquence ci-dessous **réalisée en conditions réelles** sur une machine propre. Inclure : les ports, les comptes de test pilotes (`docs/pilot/ONBOARDING.md`), la réinitialisation (`npm run db:reset`), le dépannage (volume PG16→18, build image dev). | Porte G-local (§5) | 0,5 j |

### R4 — Recette locale (ce que le doc devra documenter)

```bash
# Prérequis : Docker (compose plugin). Node ≥ 20 seulement pour les scripts hôte.
git clone <repo> && cd cr-cheDZ

# 1. Stack complète (postgres, minio, bootstrap-roles → migrate → api, worker, admin-web)
docker compose -f infrastructure/docker/docker-compose.dev.yml up --build -d

# 2. Seeds de référence (rôles/permissions système — AUCUNE donnée d'org)
#    DATABASE_URL = celle du service api du compose :
docker compose -f infrastructure/docker/docker-compose.dev.yml run --rm \
  api node scripts/seed.mjs
#  (ou, option A2, exposer 127.0.0.1:5432 en dev pour tous les scripts hôte)

# 3. Données de démo : 5 crèches pilotes SYNTHÉTIQUES (directrice, éducatrices,
#    15 enfants, parents, contrats) — comptes dans docs/pilot/ONBOARDING.md
docker compose -f infrastructure/docker/docker-compose.dev.yml run --rm \
  -e PILOT_PASSWORD='motdepasse_local_test' api \
  node scripts/pilot/seed-pilot.mjs 01 02 03 04 05

# 4. Accès
#    admin-web : http://localhost:4000  (proxy /api → api:3000)
#    API       : http://localhost:3000
#    MinIO     : http://127.0.0.1:9000 (dev uniquement)
```

Notes d'implémentation de R4 : (a) les images dev se buildent depuis le repo (`apps/*/Dockerfile.dev`, context racine) — **pas de node_modules requis sur l'hôte** ; (b) la suite d'isolation se passe en dehors du compose (elle tourne sur PG embarqué `scripts/run_pg.mjs` ou contre le dev) ; (c) vérifier au premier run que l'image `api` embarque bien `scripts/` (elle l'embarque via le context racine — à confirmer, c'est l'objet de la porte G-local) ; (d) option A2 : ajouter `ports: ["127.0.0.1:5432:5432"]` au service postgres **du dev uniquement** si on veut faire tourner les scripts hôte (`npm run db:seed`, `test:api-phase*`) directement — binding 127.0.0.1, aucun risque.

**Porte G-local** : sur machine propre : séquence ci-dessus < 30 min + checklist §5.

## PHASE 2 — SÉCURITÉ P1 (avant tout test avec données réalistes)

| ID | Action | Changement exact | Vérification | Effort |
|----|--------|------------------|--------------|--------|
| **R5** (F2, P1) | **Contrôler les rôles de enrollment** | ① Décision à acter (matrice d'autorisation → v15) : *proposition* — `list` : director + educator (scope site, lecture) ; `offer`/`decide` : director + super_admin ; **parent : rien**. ② `apps/api/src/modules/enrollment` : ajouter `@Roles(...)` sur chaque route (c'est le pattern de tous les autres modules — enrollment est le seul module sans) + check de rôle **dans le service** (défense en profondeur, comme billing/privacy). ③ Mettre à jour `docs/architecture` authorization-matrix (v14 → v15) — le module postdate la matrice, c'est la cause racine. ④ **Nouvelle suite** `tests/tenant-isolation/` (pattern phase-XX.api.test.mjs) : parent → 403 sur list/offer/decide ; educator → list OK, offer 403 ; director → offer/decide OK ; + un tenant voisin → 404/403 (isolation). | Suite nouvelle verte **et** les 61 suites existantes vertes (rien ne régresse) | 1 j |
| **R6** (F4, P2↑) | **Guider l'anonymisation contre la destruction de compte staff** | `fn_anonymize_child` (migration 067, immuable → **nouvelle migration 071** qui remplace la fonction) : si l'enfant est rattaché à un utilisateur staff actif (lien gardien→user / flag `is_staff_child`), **RAISE** avec message explicite (ou paramètre `allow_detach` + audit) au lieu de détruire le compte. Check miroir côté `privacy.service.ts`. | Test de scénario parent-employé : anonymisation refusée tant que l'attachement staff n'est pas traité ; test idempotence/anonymisation normale inchangé (le moteur 067 est transactionnel/fail-closed — ne pas le casser) | 1 j |
| **R7** (F5, P2↑) | **Fermer `/support/` au public** | `infrastructure/nginx` : retirer le `location /support/` du vhost public **ou** `allow <liste IP opérateur>; deny all;` (le commentaire « recommande VPN » devient une règle). Support-console reachable via VPN/allowlist uniquement. | `docker run --rm -v $(pwd)/infrastructure/nginx:/etc/nginx/conf.d nginx nginx -t` + check http depuis IP non listée → 403 | 2 h |
| **R8** (F3b) | **Firewall VPS documenté** | Runbook (BACKUP-RUNBOOK ou ops) : `ufw` — public : 22 (ou VPN) + 80/443 ; **local-only : 5432, 6379 (si un jour), 9000, 3000, 4000, 8091**. Le repo ne contient aucune règle de firewall : c'est un trou de documentation qui devient un trou réel. | Section firewall + checklist dans le runbook ops | 1 h |

**Porte G-sec** : suites d'isolation (61 + nouvelles) vertes ; `nginx -t` OK ; `ss -ltnp` sur VPS conforme (R3/R8) ; R5 documenté dans la matrice v15.

## PHASE 3 — P2 OPÉRATIONNEL (1–2 semaines, parallélisable)

| ID | Action | Changement exact | Vérification | Effort |
|----|--------|------------------|--------------|--------|
| **R9** (F6) | **Backup offsite + rétention assumée** | Étendre `scripts/backup.sh` (**69 lignes réelles**) : après le GPG local, pousser (rclone) vers S3/B2 ou 2ᵉ VPS ; rétention explicite et **justifiée** (locaux 7 j + offsite 30 j — justifier par la base légale 25-11 dans le runbook) ; code de sortie ≠ 0 → alerte (le relais alert-relay existe déjà, `ALERT_CHANNELS=local,email,…`) ; restore drill **mensuel hors CI** (`scripts/restore-drill.mjs`, 194 L, qui existe). | Drill mensuel documenté + alerte d'échec de backup testée (synthétique) | 1 j |
| **R10** (F7) | **Appliquer `memberships.room_ids` aux médias** | `media.service` : filtrer la liste et le download de médias par les salles du staff (aujourd'hui : tout le staff voit tout). App-level maintenant + test d'isolation ; politique DB ensuite (phase 2). | Test : staff salle A ne voit pas les médias de la salle B | 1 j |
| **R11** (F8) | **Retention des tables sync** | Job worker (pattern existant `video_clips_purge`) : purge **curseur-aware** de `sync_changelog`/`sync_operations`/`sync_inbox`/`sync_queue` — on ne coupe PAS par date simple : le changelog sert au replay (ADR-008) ; purger en dessous de `min(curseur device) - marge`. Config `SYNC_RETENTION_DAYS`. | Test : un device en retard n'est pas amputé (replay OK) ; les tables bornées après 2 cycles | 2 j |
| **R12** (F10) | **Worker : lever le goulot unique** | ① Claim de job avec `FOR UPDATE SKIP LOCKED` (vérifier le claim actuel) → `replicas: 2` en prod compose ; ② l'export long (120 s) sur sa propre file/lease plus longue pour ne pas bloquer expiration/PDF/purge. | 2 replicas sans double-exécution (preuve : 2 workers, 1 job, 1 run) ; export lancé n'empêche pas `payments_expire` | 2 j |
| **R13** (F11) | **Borner le rate limiter** | Appeler `RateLimitService.sweep()` (interval dans le bootstrap api, ou job worker périodique) — la Map mémoire est sans borne aujourd'hui. | Test mémoire stable après N req + appel visible dans le log | 2 h |
| **R14** (F12) | **Sortir les tokens web de localStorage** | admin-web + support-console : session en cookie `httpOnly; Secure; SameSite=Lax` (le refresh rotation est déjà serveur — seule la couche transport change). Les mobiles ne changent pas (flutter_secure_storage = déjà correct). ⚠️ Adapter `admin-web/e2e/session-refresh.spec.ts` au passage. | Spec session-refresh verte + absence de token dans `localStorage` (check Playwright) | 2 j |
| **R15** (F13) | **Bloquer la modification d'un run de paie finalisé** | Nouvelle migration : trigger qui refuse UPDATE/DELETE sur `payroll_runs` (et lignes liées) une fois `finalized` — copier le pattern C04 billing (les triggers no-DELETE existent déjà pour billing : réutiliser). | Test : UPDATE post-finalization → erreur ; mutation-proof si possible | 1 j |
| **R16** (F14) | **Décider du sort du sync-contract** | Le README dit « F3/F4 remain open — **Do not deploy this intermediate lot** » tandis que staff-mobile consomme déjà le client généré. Deux options : (a) fermer F3/F4 + régénérer + re-tester ; (b) **feature flag** le client généré dans staff-mobile tant qu'open. Optionner dans ce plan : **(b) maintenant, (a) en phase 4** — l'état « déployé malgré l'interdiction » est le pire des trois. | Flag documenté + status README aligné avec la réalité du code | 1 j |
| **R17** (F16) | **UI ou désactivation : enrollment & staff_shifts** | Deux routes API exposées sans console. Soit UI minimale admin-web (enrollment : liste familles en attente / offrir / décider — ~3 écrans), soit **désactiver les routes** (404) tant qu'aucune UI (le plus sûr). ⚠️ Dépend de R5 (d'abord les rôles, ensuite l'UI). | UI testée (login director → offre → décision) OU routes 404 + note dans le changelog | 2–3 j |
| **R18** (F15) | **Discipline git** | Depuis P0-1 : un commit par item de ce plan (`fix(enrollment): …`), `.gitignore` audité, removal du `pnpm-workspace.yaml` orphelin (F31) ou justification. | `git log` lisible ; un revert d'item possible | continu |
| **R19** (F17–F34) | **P3 en lot** | 18 points à 1-2 lignes chacun (détail mon rapport §4) : DB — 025 `RETURNS users` ROWTYPE (hashes en process), `EXISTS(guardians)` sans `deleted_at`, check total invoice = SUM(lines), `partially_paid` non éditable, décision `invoices_mark_overdue` SECURITY INVOKER, **national_id chiffré au repos**, SMTP hors de la tx (pire cas ~47 s), index `children(org,site)` ; app — `roles[]` dans le token d'impersonation, audit void synchrone sur les chemins critiques, `notification_preferences` scopé par org, `decide(accepted)` : créer le lien `child_guardians` ; CI/docs — commentaire stale `ci.yml` (le `.github/workflows` EST tracké), clé FCM legacy, **branch protection : exiger aussi `quality` et `backup-drill`** (aujourd'hui `database` seul) ; infra — nginx rate-limit 5r/m à réviser face CGNAT multi-staff, `run_pg.mjs` /tmp éphémère. | Chaque item = 1 commit + son test (le lot P3 est testable item par item) | 3–4 j (lot) |

**Porte G-ops** : CI complète verte (`lint`, `typecheck`, `build`, `test:unit`, `db:check-schema`, `db:check-rls`, `db:check-rls-usage`, `test:production-roles`, **tenant-isolation phase3→60**, Playwright admin-web, `backup-drill`) + smoke local (G-local rejouée).

## PHASE 4 — « PLUS ENCORE » (staging → prod)

| ID | Action | Détail | Effort |
|----|--------|--------|--------|
| **S1** (G1) | **E2E UI des flux critiques** | Playwright : billing (facture → encaissement → partial → overdue), payroll (run → finalize → blocage R15), absences, + plan de test manuel staff-mobile sync via `apps/staff-mobile/test_live/` (existant). Ne pas refaire ce que tenant-isolation couvre déjà au niveau DB — ciblées les séquences **UI** seulement. | 3 j |
| **S2** (G2) | **Épingler Flutter** | `flutter.yml` : `flutter-version: 3.47.1` (version du projet selon docs) au lieu de `channel: stable` flottant. `flutter-check` reste **non requis** mais **honnête** (choix documenté : l'historique « fake-green CI corrigé » est un asset du repo — ne pas re-mentir). | 1 h |
| **S3** (G5) | **Credentials d'alerting** | Remplir `ALERT_SMTP_*`/`ALERT_EMAIL_TO` (ou Twilio) dans le `.env` prod ; **tester avec une alerte synthétique** (un Prometheus `exec` d'alerte) — l'infra (webhook → alert-relay → email/sms/whatsapp) existe, seul le config manque. | 2 h |
| **S4** | **Charge sur cible réelle** | `tests/load/sync.k6.js` + `capacity-bench.mjs` (**208 L réels**, pas 13 307) sur la cible VPS ; documenter les cibles de capacité (staff simultané par crèche, pics de sync). **État 25/09/2026** : le banc a été rejoué en parité k6 (500 ops en 50 pushes × 10 : p95 1 406 ms, 0 erreur) ; le script k6 lui-même reste non exécuté (binaire absent) et la cible **VPS** reste à faire. | 1 j |
| **S5** | **Restore drill prod réel** | `restore-drill.mjs` sur le VPS (pas que en CI), mensuel, + `test-production-roles.mjs` (**208 L** : `creche_app` NOSUPERUSER, NOBYPASSRLS=FALSE, pas de DDL) avant chaque mise en prod. | 1 j + rituel |
| **S6** (G3) | **Audit patterns seeds** | Scan regex (téléphones DZ `0[5-7]\d{8}`, emails, NIN) sur `scripts/pilot/seed-pilot.mjs` (143 L) + seeds SQL : confirmer 100 % synthétique (l'en-tête le déclare — à prouver, pas à croire). | 30 min |
| **S7** (G4) | **Index de lecture des runbooks + ordre ops** | 31 runbooks existent ; ce qui manque : **une page d'index** (ordre de lecture : HANDOFF → CI-RESTORE → phases D/E/F/G/H → BACKUP) + l'ordre de go-live (infra → rôles → migrate → seed → api/worker → nginx → smoke). Ce que l'autre rapport appelait « créer un RUNBOOK » = en réalité **un index de 30 lignes**. | 2 h |

**Porte G-beyond** : S1–S7 verts + go-live signé (checklist issue de S7).

---

# 4. TABLEAU RÉCAPITULATIF

| Phase | Items | Effort cumulé | Porte |
|-------|-------|---------------|-------|
| 0 — baseline | P0-1, P0-2, P0-3 | 2 h | commit baseline |
| 1 — local P0 | R1 (PG18), R2 (TOTP), R3 (MinIO), R4 (recette) | **~2 j** | **G-local** : clone frais → testable < 30 min |
| 2 — sécurité | R5 (enrollment), R6 (anonymisation), R7 (/support/), R8 (firewall) | **~3,5 j** | **G-sec** : tests négatifs verts |
| 3 — opérationnel | R9–R19 (backup offsite, room_ids, sync retention, worker ×2, rate-limit, cookies, payroll lock, sync-contract, UI enrollment, git, lot P3) | **~1,5–2 sem.** | **G-ops** : CI complète verte |
| 4 — au-delà | S1–S7 (E2E UI, Flutter pin, alerting, k6, drill VPS, seeds audit, index runbooks) | **~1 sem.** | **G-beyond** : go-live |

**Ordre strict qui ne bouge pas** : P0-1 (commit) → R1+R2+R3 (tout ce qui bloque le boot/fonctionnement) → R4 → R5 (le plus grave des P1, avant toute donnée réaliste) → le reste est ordonnancé par porte.

---

# 5. DÉFINITION DE FAIT (portes)

**G-local — « testable en local » (après Phase 1)**
- [ ] `git log` ≥ 2 commits (baseline)
- [ ] PG18 : 70 migrations + `db:check-schema` + `db:check-rls` verts sur base neuve
- [ ] `docker compose -f …dev.yml up --build -d` → tous les services up (bootstrap-roles, migrate, api, worker, admin-web, minio)
- [ ] seeds + 5 crèches pilotes ; login **directrice** (pilot-01) dans `http://localhost:4000`
- [ ] Smoke métier : 1 pointage arrivée/départ, 1 entrée journal, 1 photo (MinIO), 1 export PDF (worker)
- [ ] staff-mobile : login + 1 round-trip sync
- [ ] Boot api avec `.env` dérivé du `.env.prod.example` (R2) — pas de refus G5
- [ ] `ss -ltnp` : aucun service sur 0.0.0.0 sauf nginx (R3)

**G-sec — « testable avec données réalistes » (après Phase 2)**
- [ ] parent → 403 sur enrollment (list/offer/decide) ; isolation inter-tenant conservée
- [ ] anonymisation d'un enfant rattaché à un staff → refus explicite (R6)
- [ ] `/support/` → 403 hors allowlist (R7) ; firewall doc (R8)
- [ ] 61 suites + nouvelles suites d'isolation vertes

**G-ops / G-beyond** : voir portes des Phases 3 et 4.

---

# 6. CE QU'IL NE FAUT PAS FAIRE (rejets explicites)

1. **Ne pas suivre le rapport de l'autre agent sur les versions** : il n'y a pas de PG 9.6, il n'y a pas 200 k lignes de scripts. Tout « fix » dérivé de ses chiffres (notamment « migrer vers 16+ ») irait **dans le mauvais sens** — la prod doit monter à 18, pas descendre vers 16.
2. **Ne pas toucher aux migrations 001→070** (ADR-007, checksums SHA-256 vérifiés par `migrate.mjs` : un fichier modifié = refus de replay). Toute remédiation DB = **nouvelle migration 071+** ou code/config. C'est aussi ce qui rend R6 (remplacer `fn_anonymize_child`) une migration de remplacement, pas un edit.
3. **Ne pas « externaliser les checks dans un linter standard »** (reco. de l'autre rapport) : les `check-*`/`test-*` (3,3 k lignes) encodent des invariants spécifiques (RLS par catalogue, rôles prod, contrat sync) — on modularise si besoin, on ne remplace pas.
4. **Ne pas « créer un runbook »** : il y en a 31. Faire l'index (S7), pas du doublon.
5. **Ne pas faire S1 (E2E UI) avant G-local** : on ne teste pas UI ce qui ne tourne pas.
6. **Ne pas faire R14 (cookies) en slipstream** : c'est le seul item qui casse la couche de session web — il a sa propre spec Playwright à adapter, pas de commit mixte.
7. **Ne pas rediffuser le rapport de l'autre agent** sans la mention « non fiable » (§1.1) : le 9.6 et les 23 000 lignes vont produire de mauvaises décisions chez le prochain lecteur.

---

*Document généré le 2026-09-21 à partir de l'analyse A→Z (10 tranches, notes dans `/home/user/analyse-cr-chedz/`) + re-vérification ligne à ligne des claims du second rapport. Prochaine action proposée : exécuter la Phase 0 + Phase 1 (P0-1, R1, R2, R3, R4) et faire passer la porte G-local.*

---

## STATUT — Phases 0 + 1 exécutées (2026-09-21)

- **P0-1** ✅ baseline commit avant toute modification — historique de remédiation traçable sur la branche.
- **P0-2** ✅ corrections de volumes consignées (§1.1, §1.4).
- **P0-3** ✅ README : toolchain vérifiée (Flutter 3.47.1, React 19, NestJS 11) + prérequis (Docker, Node ≥ 20, k6).
- **R1** ✅ PG18 partout : compose dev/staging/prod (+ conteneur backup), CI `backup-drill` sur `postgres:18`, README, docs live (runbooks D/H1, BACKUP-RUNBOOK + procédure « Upgrade 16 → 18 », tenant-isolation README). Pièces à l'appui : note ci-dessous (§ STATUT R1).
- **R2** ✅ `TOTP_ENCRYPTION_KEY` présente dans `.env.prod.example` (garde prod vérifiée : l'exemple rempli passe `validateProductionConfig`) ; gap bonus corrigé : `STORAGE_BACKEND` absent de `.env.example` ; garde anti-régression `npm run check:env-example` (verte).
- **R3** ✅ MinIO prod bound `127.0.0.1` (plus de `0.0.0.0:9000`) ; le dev était déjà correct.
- **R4** ✅ `docs/LOCAL-RUN.md` : voie A (Docker) / voie B (hôte, PG18 embarqué) + checklist G-local + dépannage.

### STATUT R1 — Preuves d'exécution (sandbox sans Docker, 2026-09-21)

- PostgreSQL **18.4 réel** (embarqué, `run_pg.mjs`) : **70/70 migrations** (dont 003 `NULLS NOT DISTINCT`, 067, 070), seeds, `schema-check` ✓, `rls-behavior-check` (GATE RLS, rôle NOBYPASSRLS) ✓.
- Smoke API sur la base migrée : boot Nest OK, `GET /api/v1/health` → `{"status":"ok"}`.
- CI réelle d'e3355ec (vérifiée via GitHub API) : **tous jobs verts**, dont `database` et `backup-drill` — la source du drill était encore `postgres:16` et **acceptait les 70 migrations** : le schéma s'applique aussi sur 16. **Affinement honnête du F1** : ce n'est pas un bloc dur (« la prod ne peut pas appliquer le schéma ») mais un **écart de politique/validation** (politique écrite « JAMAIS 16/17 », validation unique sur 18 où un bug réel a été découvert). L'alignement total sur 18 (R1) supprime l'écart ; le wording du F1 dans le rapport initial est à lire à cette lumière.
- Nuance CI : en `GITHUB_ACTIONS=true`, `run-isolation-suites.sh` sort en avance et ne joue que `test-production-roles.mjs` (job `database`) — la liste de 61 suites est le **canon local**. Les exécutions locales de ce statut sont donc plus larges que la CI.

### G-local — état

- **Voie B (hôte) : VALIDÉE** (migrations PG18 + GATE RLS + boot API, ci-dessus). Suites d'isolation — résultat final :
  - **Gate D (`test-production-roles.mjs`, équivalent exact du job `database` CI, rôles de production) : 65/65 suites vertes, preuves H2a–H2l + G1–G5 OK, rc=0** sur PG 18.4 local (2026-09-21).
  - Canon local simple (`run-isolation-suites.sh` sans mode rôles) : 62/65 — les 3 échecs (phase22/47/49) sont **par conception** : `appUrl()` renvoie `creche_app_test` alors que la garde exige `creche_app` sous `NODE_ENV=production` ; ces checks ne passent qu'en Gate D. Documenté dans `docs/LOCAL-RUN.md` § « Les deux modes d'exécution des suites ».
  - Nuance CI : le job `database` CI exécute en réalité le **Gate D** (sortie en avance du runner sous `GITHUB_ACTIONS=true`) — la liste de 61 suites n'est pas jouée en CI. Le Gate D local est donc l'équivalent le plus strict, pas un sous-ensemble.
- **Voie A (Docker) + smokes UI** (login directrice, photo MinIO, export PDF, sync staff-mobile) : à rejouer sur la machine cible — pas de Docker dans la sandbox d'exécution.
