# HANDOFF — Issues ouvertes (état au 2026-10-14)

> Document de reprise pour l'agent suivant (Antigravity ou autre), **sans Docker**.
> Chaque tâche : état vérifié, étapes exactes, critère d'acceptation, et si elle
> exige un humain. Ce qui n'a PAS été vérifié est dit explicitement.

- Dépôt : `Allintelligence2024/cr-cheDZ`
- Base : `main` @ `6663707`
- PR ouverte : **#57** (branche `arena/f275b114-cr-chedz`) — ADR-015 + suivi + correction de compteur + helper PostgreSQL.
- Issues ouvertes : #14, #15, #16, #17, #35, #38, #39, #40, #41, #42, #55.

---

## 0. Règles non négociables

1. **Sans Docker** : tout passe par `npm ci` + PostgreSQL 18 embarqué (section 1). Ne rien
   dépendre de `docker compose`. Les scripts qui exigent Docker sont listés en section 6 et restent hors périmètre.
2. **Aucun merge** sans autorisation client (règle du dépôt). Ouvrir des PR, ne pas merger.
3. **Migrations 001–102 immuables** (ADR-007). Toute correction SQL = nouvelle migration, **numéro 103 et suivants**.
4. **Ne jamais affaiblir un test ou un contrat** pour le faire passer. Un compteur de doc
   qui diverge se corrige dans le document (voir `claims-contract.test.mjs`), pas dans le contrat.
5. **Ne jamais lancer `npm audit fix`** : il proposerait un downgrade de `@nestjs/core` 11 → 7.
6. **Ne jamais committer** `node_modules/`, un SDK Flutter, un `.zip`, un keystore, un `.env`.
7. **Droits GitHub** : au 2026-10-14, le jeton de session renvoie **403 sur toute écriture d'issue**
   (commentaire, fermeture) mais ouvre des PR. Si la même erreur survient, passer les actions
   d'issues à un humain (section 7 : texte prêt à coller).

---

## 1. Environnement sans Docker (à faire une fois)

```bash
# Prérequis : Node 22 (engines >=20), git, gzip. Aucun Docker.
git clone https://github.com/Allintelligence2024/cr-cheDZ.git && cd cr-cheDZ
git checkout arena/f275b114-cr-chedz        # ou main après merge de #57
npm ci                                      # ~20 s ; installe aussi les binaires PostgreSQL embarqués

# PostgreSQL 18.4 embarqué (même version majeure que la CI `postgres:18`)
bash scripts/local-embedded-postgres.sh start    # crée creche_test sur le port 54329
eval "$(bash scripts/local-embedded-postgres.sh env)"   # exporte DATABASE_URL
node scripts/migrate.mjs                         # 101 fichiers appliqués (001→102, 083 fusionnée)
node scripts/seed.mjs
npm run build --workspace @creche/api && npm run build --workspace @creche/worker
bash scripts/local-embedded-postgres.sh stop     # quand c'est fini
```

Variables utilisées par les suites (issues de `.github/workflows/ci.yml`) :

```bash
export RATE_LIMIT_DISABLED=1 NODE_ENV=test STORAGE_BACKEND=local \
  STORAGE_LOCAL_DIR=/tmp/creche-storage-tests PAYMENT_WEBHOOK_SECRET=phase8-test-secret
mkdir -p /tmp/creche-storage-tests
```

Flutter (pour les tâches F, H3 et #15/#16), version **pinnée** dans `scripts/flutter-sdk.mjs` :

```bash
git clone --depth 1 --branch 3.47.1 https://github.com/flutter/flutter.git ~/flutter-sdk
git -C ~/flutter-sdk rev-parse '3.47.1^{commit}'   # doit donner 6655482ec06e547f90abf8ae7590466f4415978d
export PATH="$HOME/flutter-sdk/bin:$PATH" && flutter --version
```

> Le téléchargement des artefacts moteur Flutter et `pub.dev` exigent un accès réseau
> qui n'était PAS disponible dans la session de revue. Sur une machine ordinaire, c'est direct.

---

## 2. Base vérifiée (ce qui est déjà vert, 2026-10-14, sur `6663707` + PR #57)

| Contrôle | Commande | Résultat |
|---|---|---|
| Audit prod | `npm audit --omit=dev --audit-level=low` | **0 vulnérabilité** |
| Lint | `npm run lint` (`--max-warnings=0`) | **0 erreur, 0 warning** |
| Typecheck | `npm run typecheck` | vert |
| Build | `npm run build --workspace @creche/api` / `@creche/worker` | vert |
| Tests unitaires | `npm run test:unit` | vert |
| Migrations | `node scripts/migrate.mjs --status` | 101 appliquées, schéma cohérent |
| Schéma / RLS | `node tests/tenant-isolation/schema-check.mjs --verbose`, `rls-behavior-check.mjs` | verts |
| Indexation tenant | `node scripts/check-tenant-index.mjs --verbose` | vert |
| Garde RLS catalogue | `node scripts/check-rls-usage.mjs` | 68 accès conformes |
| Env example | `node scripts/check-env-example.mjs` | vert |
| Manifest Android | `node scripts/check-android-manifest.mjs` | vert |
| Gardiens câblés | `node scripts/check-guards-wired.mjs` | 15 gardiens, vert |
| PII seeds | `node scripts/audit-seeds-pii.mjs --strict` | vert |
| Contrat documentaire | `node --test tests/tenant-isolation/claims-contract.test.mjs` | **12/12** (après correction PR #57) |
| Contrat de sync | `node scripts/check-sync-contract.mjs` | vert |
| Inventaire routes | `npm run check:routes-inventory` | 205 routes, **40 sans `@Roles`/`@Public`** |
| **Gate Phase D (rôles de prod)** | voir section 3.1 | **77/77 suites vertes** |

Non vérifié ici : `check-staff-sync.mjs` (exige Flutter), tests Flutter, toute étape Docker.

---

## 3. Tâches par issue

Ordre conseillé : 1 → 2 → 3 (rapides, purement administratives) puis 4 → 9 (travail de fond).

### 3.1 Issue #38 — Phase D : RLS effective en prod

**État** : gate technique **vert** (77/77 sous rôles de prod, `creche_app` NOBYPASSRLS, `creche_migrator`).
Restent : plan de rollback écrit, décision de moteur, preuve de sauvegarde (liée à #14).

Étapes :
1. Relancer le gate pour preuve (≈ 20 min) :
   ```bash
   bash scripts/local-embedded-postgres.sh start && eval "$(bash scripts/local-embedded-postgres.sh env)"
   npm run build --workspace @creche/api && npm run build --workspace @creche/worker
   ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs | tee /tmp/roles-gate.log
   tail -3 /tmp/roles-gate.log   # attendu : « 77/77 suites vertes » puis « GATE D : … »
   ```
   **Ne pas** utiliser `bash scripts/run-isolation-suites.sh` comme preuve : sous le superuser
   `postgres`, 4 suites échouent volontairement (`DATABASE_ROLE_UNSAFE`, `phase36` exige `ALLOW_DATABASE_RESET`).
2. **Rédiger le plan de rollback** dans `docs/PHASE_D_ROLES_RUNBOOK.md` (section absente : `grep -i rollback` ne trouve rien).
   Contenu minimal : migrations forward-only ⇒ rollback = restauration de sauvegarde (#14) +
   image applicative précédente ; ordre de révocation des rôles ; qui décide.
3. **Décision moteur** : la CI utilise `postgres:18`, le local est validé en 18.4. Écrire la décision
   (ADR court) pour fermer la ligne « choix 16 vs 18 » du plan §D.
4. **Câblage CI** (« action humaine workflows » dans le plan) : vérifier dans `ci.yml` que le job
   `database` appelle `run-isolation-suites.sh` avec `GITHUB_ACTIONS=true` (ce qui déclenche le gate
   strict). Confirmer par un run CI, pas par lecture seule.

Critère : gate 77/77 consigné ; rollback écrit et relu ; décision moteur consignée.
Humain requis : relecture du rollback par le responsable d'exploitation.

### 3.2 Issue #39 — Phase E : fiabilité du worker

**État** : E1–E6 implémentés et couverts par les suites (`phase27-worker-lifecycle`, `phase28-worker-reliability`,
inclus dans le gate 77/77). Les tests de reprise après arrêt brutal existent (`SIGKILL` présent dans ces fichiers).

Restent :
1. **Décision client « payroll sans prorata »** (plan §H3, ligne 762). Bloquant pour la règle de paie. **Humain.**
2. **Activation d'exploitation E2** : coordonnées SMTP / Twilio réelles (plan ligne 321). **Humain** (secrets).
3. **Gate monitoring E2** (`test-worker-monitoring-stack.mjs`) : exige Docker. **Hors périmètre sans Docker** — laisser à la CI.
4. Pour preuve, vérifier que `phase27`/`phase28` couvrent bien : `kill -9` du worker → job repris après bail expiré,
   et aucun job `processing` orphelin. Lire les assertions et noter les noms de tests dans le runbook E.

Critère : décision paie consignée ; E2 activé par le client ; preuves de reprise notées.

### 3.3 Issue #40 — Phase F : contrat de sync mobile bout-à-bout

**État** : F1 (contrat partagé) et F3 (curseurs) vérifiés par les suites (`phase29`–`phase34`, 7 à 27 assertions chacune, toutes vertes au gate 77/77).
**Non vérifié ici** : F2 et F4 côté Dart (pas de Flutter dans la session).

Étapes (avec Flutter 3.47.1 installé, section 1) :
1. Dépendances figées :
   ```bash
   cd apps/staff-mobile && flutter pub get --enforce-lockfile && flutter analyze && flutter test --no-pub
   cd ../parent-mobile && flutter pub get --enforce-lockfile && flutter analyze && flutter test --no-pub
   cd ../director-mobile && flutter pub get --enforce-lockfile && flutter analyze
   ```
2. **Gate F2 (client Dart ↔ DTO)** : `cd /home/user/cr-cheDZ && node scripts/check-staff-sync.mjs`
   (Docker non requis si `GITHUB_ACTIONS` et `FLUTTER_USE_DOCKER` sont absents).
3. **Gate F4 bout-à-bout** (API réelle + Flutter réel) :
   ```bash
   eval "$(bash scripts/local-embedded-postgres.sh env)"; export RATE_LIMIT_DISABLED=1 NODE_ENV=test
   npm run build --workspace @creche/api
   node scripts/test-sync-api-flutter.mjs
   ```
   Le script exécute `flutter test test_live/sync_api_f4_test.dart` localement et vérifie que
   `pubspec.lock` n'a pas changé. Attendu : exit 0.
4. Consigner les sorties dans `docs/PHASE_F2_CLIENT_RUNBOOK.md` / `PHASE_F3C_F4_RUNBOOK.md`.

Restent hors périmètre : qualification **Android release** (plan ligne 480) — nécessite un keystore réel (**humain**).

Critère : `flutter analyze` sans erreur, `flutter test` vert sur staff/parent, F4 exit 0 sans Docker.

### 3.4 Issue #41 — Phase G : HIGH restants

**État** : G1 (auth), G2 (RLS), G3a (DPIA), G4 (révocation), G5 (MFA) livrés et verts dans le gate 77/77.

Restent :
1. **`next_org_sequence`** : décision légale et produit. Lire `docs/adr/ADR-015-next-org-sequence-numbering.md`
   (statut **Proposé**). **Humain** tranche entre A / B / C. Après décision, implémenter dans une **nouvelle migration (103+)** :
   - si B : colonne de référence publique opaque + backfill + test « référence non devinable » + numéro légal inchangé ;
   - mettre à jour `billing.service.ts`, `payment-provider.service.ts` et le webhook selon le choix.
   - Ne pas modifier `017_children_reference.sql` ni `024`/`039`.
2. **Invitations : livraison réelle / nonce / réinvitation** (plan lignes 524, 555) : transport SMTP non implémenté.
   Décision fournisseur **humaine**, puis implémentation (nonce + version dans le jeton d'invitation).
3. **Frontières restantes** (plan ligne 579) : autorités des helpers privilégiés, `UPDATE/DELETE` restreints.
   Tâche agent : lister les fonctions `SECURITY DEFINER` et les grants `UPDATE/DELETE` (`grep -rn "SECURITY DEFINER" infrastructure/database/migrations`), décider lesquelles restreindre, écrire un test par frontière.
4. **Historique des décisions / renouvellement DPIA** (plan ligne 602) : hors périmètre technique immédiat — noter comme dette.

Critère : décision `next_org_sequence` consignée (ADR → Accepté) ; invitations : transport décidé ; frontières listées avec test.

### 3.5 Issue #42 — Phase H : staging, dette MEDIUM/LOW

Sans Docker :

1. **Reproductibilité du lockfile** (plan ligne 763) — `pnpm-workspace.yaml` **n'existe plus** :
   ```bash
   ls pnpm-workspace.yaml 2>&1      # attendu : absent
   rm -rf /tmp/clone && git clone -q . /tmp/clone && cd /tmp/clone && git checkout -q <SHA_TESTÉ> && npm ci && git status --short
   ```
   Si `git status` est vide après `npm ci` sur un clone propre, cocher l'item.

2. **Overrides `body-parser`** (plan ligne 766) — **problème réel, non résolu** :
   - `npm ls body-parser` affiche `body-parser@1.20.8 invalid: "^2.2.1" from node_modules/express`
     (Express 5.2.1 exige body-parser 2.x). Aucun `package.json` ne demande 1.20.8.
   - **Essais déjà faits, à ne pas répéter** (lockfile restauré à chaque fois) :
     a. `npm install --package-lock-only` : « up to date », rien ne change.
     b. Suppression de l'entrée `node_modules/body-parser` du lockfile : npm n'ajoute pas de remplacement, le lockfile devient incohérent.
     c. Suppression de l'entrée + `rm -rf node_modules` + `npm install --package-lock-only` : même résultat que (b).
   - **Piste à tester** (non vérifiée) : override racine explicite, puis resolution propre :
     ```bash
     # package.json → "overrides": { ..., "body-parser": "2.3.0" }
     npm install --package-lock-only --ignore-scripts
     npm ls body-parser qs          # attendu : aucune erreur ELSPROBLEMS
     npm audit --omit=dev --audit-level=low
     npm ci && npm run typecheck && npm run build
     ```
     Puis les suites HTTP qui touchent le corps de requête (413) : `phase22-audit-fixes`, `phase43-auth-hardening`,
     `phase46-refresh-rotation`, `phase64-auth-cookies`, `isolation`. Le test « corps trop volumineux → 413 » doit rester vert.
   - Si la piste échoue : documenter le pin dans le plan au lieu de forcer un override.

3. **Routes sans `@Roles`/`@Public`** (plan ligne 778) — l'inventaire annonce **40** routes (le plan disait 44) :
   `npm run check:routes-inventory`. Revue module par module ; pour chaque route self-service conservée
   sans garde, écrire la justification dans `docs/architecture/authorization-matrix.md`. Ne pas ajouter de garde sans test.

4. **H3 — LOW** (plan lignes 782–789) :
   - Validation téléphone algérien `+213` / `0X XX XX XX XX` : tâche agent (validation DTO + tests unitaires).
   - Arabe manquant : `nap_start`, `{n} enfant(s)` non interpolé, notifications push français seulement. Tâche agent (i18n) ; relire avec un locuteur **humain**.
   - Test parent-mobile qui ne compile pas : remplacer par un vrai widget test (nécessite Flutter).
   - Harmonisation timezone UTC+1 : auditer les autres modules, un par un.
   - `flutter.zip` : **vérifié absent** (ni suivi par git, ni présent dans l'arbre) → cocher.

Docker-only (hors périmètre) : `docker-compose.staging.yml`, `build-minio-image.mjs`, `registry-pull.mjs`,
`test-staging-stack.mjs`, `test-worker-monitoring-stack.mjs`, `test-metrics-collector-stack.mjs`.

Décision **humaine** : revue de sécurité du stockage / pin MinIO (plan ligne 643).

Critère : lockfile reproductible prouvé sur clone propre ; `body-parser` valide (`npm ls` sans erreur) ou pin documenté ; inventaire des 40 routes justifié.

### 3.6 Issue #14 — Restauration sur VM vierge, chronométrée

**État** : le drill existe (`scripts/restore-drill.mjs`, exécuté en CI job `backup-drill` sur `postgres:18`). Il n'a **pas** été exécuté ici : `gpg` absent et pas de VM.
Les critères de l'issue sont **périmés** : 001–049 et « 61/61 » ne correspondent plus au dépôt (migrations 001–102, 101 fichiers appliqués).
Mettre à jour l'issue avec les critères ci-dessous.

Étapes :
1. VM Ubuntu 22.04 **vierge**, opérateur **différent** de celui qui a écrit le runbook (`docs/BACKUP-RUNBOOK.md`, section « Pré-requis VM clean »).
2. Installer les outils :
   ```bash
   sudo apt-get update
   sudo apt-get install -y gnupg gzip curl ca-certificates git
   # Client PostgreSQL 18 depuis PGDG (pg_dump refuse un serveur plus récent que lui) :
   sudo install -d /usr/share/postgresql-common/pgdg
   sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
   echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
   sudo apt-get update && sudo apt-get install -y postgresql-client-18
   pg_dump --version   # attendu : 18.x
   ```
   Node 22 : via `nvm` ou le dépôt NodeSource.
3. Serveur source : base `*_test` (le drill l'exige, sauf `DRILL_ALLOW_NON_TEST=1`) :
   ```bash
   git clone <dépôt> && cd cr-cheDZ && npm ci
   bash scripts/local-embedded-postgres.sh start && eval "$(bash scripts/local-embedded-postgres.sh env)"
   node scripts/migrate.mjs && node scripts/seed.mjs
   ```
4. Drill chronométré :
   ```bash
   export BACKUP_PASSPHRASE='<passphrase de test, non réutilisée>'
   time node scripts/restore-drill.mjs | tee /tmp/restore-drill.log
   echo "exit=$?"
   ```
5. Vérifications après restauration (base `restore_drill_target`, à créer si le drill la supprime) :
   ```sql
   SELECT count(*) FROM organizations;   -- > 0
   SELECT count(*) FROM children;        -- > 0
   SELECT count(*) FROM users WHERE email LIKE '%@test.dz';  -- >= 1 parent après restauration
   ```
   Et `node scripts/migrate.mjs --status` (toutes lignes « appliquée »).
6. Consigner dans `docs/BACKUP-RUNBOOK.md` : date, opérateur, durée (`time`), tailles, exit code.

Critères : exit 0 ; durée **< 30 min** (runbook) et objectif **< 15 min pour < 1 Go** ; tables > 0 ; un tenant et un parent retrouvés.

### 3.7 Issue #15 — intl ^0.20.3

**État** : **déjà corrigé** : `intl ^0.20.3` dans les trois `pubspec.yaml`, workflow `flutter` vert sur `main`.
Action : vérifier localement puis fermer (section 7).
```bash
for app in parent-mobile staff-mobile director-mobile; do (cd apps/$app && flutter pub get --enforce-lockfile); done
```

### 3.8 Issue #16 — build_runner staff-mobile

**État** : **déjà corrigé** : `app_database.g.dart` (3 582 lignes) committé.
Vérifier que le fichier committé est bien celui que génère le code actuel :
```bash
cd apps/staff-mobile && flutter pub get && dart run build_runner build --delete-conflicting-outputs
git diff --exit-code -- lib/core/database/app_database.g.dart && echo "GÉNÉRÉ EN SYNC"
flutter analyze && flutter test --no-pub
```
Si le diff n'est pas vide : committer la régénération (c'est la seule correction nécessaire).

### 3.9 Issue #17 — lint (72 warnings)

**État** : **périmé**. `npm run lint` → 0 warning.
Reste un avertissement non bloquant : `MODULE_TYPELESS_PACKAGE_JSON` pour `packages/shared-config/eslint.config.js`.
Correction optionnelle : ajouter `"type": "module"` à `packages/shared-config/package.json` **après** avoir vérifié
que le reste du paquet est bien ESM (sinon ne pas toucher). Puis `npm run lint` doit toujours être à 0.

### 3.10 Issues #35 et #55 — `npm audit` / `multer` / `nodemailer`

**État** : **résolu** : `npm audit --omit=dev --audit-level=low` → 0. `multer` 2.4.0 (override), `nodemailer` 10.x.
Action : fermer (section 7). Le workflow `security-audit.yml` rouvrira une issue automatiquement si l'audit redevient rouge.

---

## 4. Ce qui ne peut pas être fait sans Docker (à confier à la CI ou à une machine avec Docker)

- `docker-compose.staging.yml` (H1) ; `build-minio-image.mjs` ; `registry-pull.mjs`.
- Stacks monitoring (E2, H2j/H2k) : `test-worker-monitoring-stack.mjs`, `test-metrics-collector-stack.mjs`, `prom/prometheus`, `prom/alertmanager`.
- `test-staging-stack.mjs`.
- Build d'image Docker (`docker.yml`).

---

## 5. Décisions humaines à obtenir (liste à transmettre au client)

| # | Décision | Bloque | Référence |
|---|---|---|---|
| D1 | Numérotation factures : séquentiel légal vs référence publique opaque | #41 | ADR-015 |
| D2 | Paie sans prorata (règle de paie) | #39, #42 | plan H3 l.762 |
| D3 | Fournisseur SMTP / Twilio et secrets d'exploitation | #39 E2, #41 invitations | plan l.321, l.524 |
| D4 | Revue de sécurité du stockage / pin MinIO | #42 | plan l.643 |
| D5 | Keystore Android et qualification release | #40 | plan l.480 |
| D6 | Autorisation de merger #57 et des PR de phase | tout | règle du dépôt |

---

## 6. Ordre de travail recommandé

1. Vérifications rapides : #15, #16, #17, #35, #55 (section 3.7–3.10).
2. Lockfile / `body-parser` (3.5 point 2) — seul vrai défaut de dépendances restant.
3. Phase D : rollback écrit + gate 77/77 consigné (3.1).
4. Phase F : Flutter local, F2 et F4 (3.3).
5. Phase H3 agent-tasks : téléphone, i18n, timezone, routes sans garde (3.5).
6. Phase G : frontières privilégiées (3.4 point 3).
7. #14 : drill sur VM (opérateur humain).
8. Décisions D1–D6 : transmises au client.

---

## 7. Actions GitHub (à faire par un humain si le jeton renvoie 403)

Fermer avec ce commentaire :

- **#55, #35** : « Résolu sur `main` : `npm audit --omit=dev` → 0 vulnérabilité ; `multer` 2.4.0, `nodemailer` 10.x. Revérifié le 2026-10-14. »
- **#17** : « Périmé : `npm run lint` (`--max-warnings=0`) → 0 warning sur `main`. »
- **#15** : « Résolu : `intl ^0.20.3` dans les trois apps ; workflow `flutter` vert sur `main`. »
- **#16** : « Résolu : `app_database.g.dart` committé et généré ; workflow `flutter` vert sur `main`. »

Mettre à jour les critères de **#14** (migrations 001–102, plus de « 61/61 ») et ajouter une référence à ce document aux issues #38–#42.

---

## 8. Historique de la session de revue (pour traçabilité)

- Gate strict `test-production-roles.mjs` : **77/77** (Postgres 18.4 embarqué, 2026-10-14).
- Suites sous superuser (`run-isolation-suites.sh`) : 73/77 ; les 4 échecs (`phase22`, `phase36`, `phase47`, `phase49`) sont **attendus** hors gate de rôles de prod.
- `claims-contract.test.mjs` : échec introduit par ADR-015 (compteur 15 → 16) ; corrigé dans `docs/VERIFICATION_ANALYSE_2026-09-24.md` (12/12).
- Helper ajouté : `scripts/local-embedded-postgres.sh` (start / status / env / stop, testé).
- Lockfile : **non modifié** (tentatives documentées en 3.5 point 2, restaurées).
