# CURSOR PROMPT — Finalisation missions restantes (après P3 + Antigravity)

> Copie-colle ce fichier entier comme prompt dans Cursor (Agent Mode) — il contient tout le contexte + les tâches restantes que tu faisais à la main via MCP. Cursor a accès filesystem, terminal, git, GitHub.

## Contexte à charger

```
Repo : Allintelligence2024/cr-cheDZ
Main @ 4804402 (PR #18 merged) — CI verte obligatoire : postgres:18 + branch protection exige job database (seul required)
Stack : NestJS 11.1 + React 19 + Flutter 3.47.1 stable + GHCR ghcr.io/creche-saas/{api,worker,admin-web,support-console}:latest+SHA
Migrations 001→052 immuables (ADR-007), 28/28 suites isolation sur PG18 réel NOBYPASSRLS, garde config P1 @creche/prod-config
Flutter CI : maintenant honnête (plus de faux vert cirruslabs). PR #12 merged : subosito/flutter-action@v2 channel: stable
Issue #8 : OPEN — "Flutter — build + run (CI corrigée : vrai statut, non faux vert)" — doit rester ouverte jusqu'à vert pub get && analyze && build
```

## État actuel des PRs (vérifié 2026-08-26)

- #13 OPEN arena/p3-backup-runbook docs(ops): RUNBOOK restauration backup.sh — old, à fermer (remplacé par #18 mergée)
- #18 MERGED arena/ops-runbooks-v2 docs(ops): backup runbook + secrets + pilot protocol + antigravity MCP
- #19 CLOSED arena/antigravity-missions fix(mobile): bump intl (33 fichiers mélangés) — fermée, remplacée par #22 clean
- #20 CLOSED arena/lint-burn-down base old cf7556f (revert P3) — fermée
- #21 CLOSED arena/lint-burn-down base old — fermée
- #22 OPEN fix/mobile-intl-bump fix(mobile): bump intl to ^0.20.3 — clean depuis main, 2 fichiers pubspec.yaml, CI: database SUCCESS, docker SUCCESS, flutter-check FAILURE (parent-mobile pub get + analyze failure)
- #23 OPEN chore/lint-burn-down-v2 chore(lint): burn-down any warnings, zero max-warnings — clean depuis main, 22 fichiers admin-web/support-console any→unknown, max-warnings 72→0

## Mission 1 — Fermer doublons et vieux PRs (si pas déjà fait)

```bash
gh pr view 13 --json title,state
# Si docs/BACKUP-RUNBOOK.md déjà dans main via #18, fermer #13
gh pr close 13 --comment "Remplacé par #18 mergée (runbooks complets BACKUP-RUNBOOK.md + OPERATIONS-SECRETS.md + PILOT-PROTOCOL.md + ANTIGRAVITY-MCP.md)"

gh pr view 19 --json state
gh pr view 21 --json state
# Déjà fermées, sinon :
gh pr close 19 --comment "Remplacée par #22 clean depuis main"
gh pr close 21 --comment "Base old cf7556f revert P3 — recréer depuis chore/lint-burn-down-v2"
```

## Mission 2 — Fix Flutter intl bump (PR #22) — rendre vert

**Problème actuel** : PR #22 a `intl: ^0.20.3` mais CI flutter échoue encore à `parent-mobile — pub get + analyze: failure`. Sans logs (réseau GH instable EOF), cause probable suivante : Drift `app_database.g.dart` manquant ou autre dep.

**Steps Cursor** :
1. `read` `apps/parent-mobile/pubspec.yaml` et `apps/staff-mobile/pubspec.yaml` → vérifier `intl: ^0.20.3`
2. `terminal` `cd apps/parent-mobile && flutter pub get` (nécessite Flutter SDK 3.47.1 — installer via `subosito/flutter-action` local ou `flutter` CLI)
3. Si `pub get` passe, `terminal` `flutter analyze` → lister erreurs restantes
4. Si erreur est `app_database.g.dart` manquant, passer à Mission 3
5. Si autre dep (ex: `path`, `uuid`, etc.), bump dans `pubspec.yaml` et commit
6. `git` commit + push + `gh pr checks 22` jusqu'à vert

**Non-négociable** : ne pas modifier migrations 001-052, ne pas committer `.env`, une PR = une dette.

## Mission 3 — Drift g.dart (le blocage restant)

**Blocage** : `apps/staff-mobile/lib/core/database/app_database.dart` a `part 'app_database.g.dart';` mais fichier absent → `build_runner` jamais exécuté.

**Steps Cursor** (nécessite Flutter SDK) :
```bash
# Installer Flutter SDK si absent
# Via https://docs.flutter.dev/get-started/install ou via Docker cirruslabs/flutter:stable mais avec volume

cd apps/staff-mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
# Vérif
ls lib/core/database/app_database.g.dart
flutter analyze
```

Puis :
```bash
git checkout -b fix/mobile-drift-gdart
git add apps/staff-mobile/lib/core/database/app_database.g.dart
git commit -m "fix(mobile): generate Drift app_database.g.dart (build_runner)"
git push origin fix/mobile-drift-gdart
gh pr create --base main --head fix/mobile-drift-gdart --title "fix(mobile): generate Drift app_database.g.dart" --body "Généré via dart run build_runner build --delete-conflicting-outputs. Closes part of #8. Après ce PR, flutter pub get && analyze doit être vert, puis flutter build."
```

## Mission 4 — Lint burn-down PR #23 — rendre vert et merger

**État** : PR #23 `chore/lint-burn-down-v2` clean depuis main, 22 fichiers, `package.json` `max-warnings 0`, mais CI `database null` (pas encore lancée) + `flutter-check FAILURE`.

**Steps Cursor** :
1. `git checkout chore/lint-burn-down-v2`
2. `terminal` `npm ci && npm run lint` → doit être 0 warnings
3. `terminal` `npm run typecheck` → 4 apps 0 erreur
4. `terminal` `npm audit --omit=dev` → 0 vuln
5. Si vert local, `git push` et attendre `gh pr checks 23` → `database SUCCESS` requis
6. Une fois `database SUCCESS` + `docker SUCCESS`, merger via `gh pr merge 23 --merge --admin` ou via UI (nécessite permission workflows si CI touche workflows, sinon docs only OK)

## Mission 5 — Fermer issue #8 après vert CI

**Condition** : `flutter pub get && flutter analyze && flutter build` vert en CI (actuellement rouge honnête).

**Steps Cursor** :
```bash
gh run list --branch fix/mobile-intl-bump --json name,conclusion | grep flutter
gh run list --branch fix/mobile-drift-gdart --json name,conclusion | grep flutter
# Quand vert :
gh issue close 8 --comment "Fix #8 — intl bumped to ^0.20.3 + Drift g.dart generated, CI flutter green (pub get && analyze && build)"
```

## Mission 6 — Docs ops restants (si pas mergés)

**Fichiers déjà mergés en #18** : `BACKUP-RUNBOOK.md`, `OPERATIONS-SECRETS.md`, `PILOT-PROTOCOL.md`, `ANTIGRAVITY-MCP.md`

**Si tu veux aller plus loin (travail humain via Cursor + MCP)** :

### 6a. Backup restore exercise <30min
- Lire `docs/BACKUP-RUNBOOK.md` + `scripts/backup.sh` + `docs/RUNBOOK.md §2/§5`
- Créer VM clean Docker : `docker run -d --name pg-restore -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:18`
- `gpg --decrypt $BACKUP | gunzip | psql $DATABASE_URL_RESTORE`
- `DATABASE_URL=$RESTORE node scripts/migrate.mjs --check` → vert
- `bash scripts/run-isolation-suites.sh` → 28/28
- Écrire `docs/pilot/BILAN-PILOTE.md` § Exercice restauration : temps, taille, verdict
- PR `docs: backup restore exercise <30min`

### 6b. Secrets réels
- Lire `packages/prod-config/src/index.ts` (garde P1)
- Via vault MCP : SATIM, WHATSAPP, FCM, APNs, SMTP
- `.env.prod` depuis `.env.prod.example` (jamais commité)
- Tester `NODE_ENV=production node apps/api/dist/main.js` → API prête
- PR docs (sans secrets en clair)

### 6c. Pilote terrain
- `node scripts/pilot/seed-pilot.mjs` + `pilot-report.mjs --bench`
- Remplir `CHECKLIST_PILOTE.md` quotidien via `/metrics`
- Bilan + go/no-go

## Règles non négociables pour Cursor

- Ne jamais modifier migrations 001-052 (immuables ADR-007)
- Ne jamais bypass RLS — `node scripts/check-rls-usage.mjs` doit rester vert
- Ne jamais committer `.env.prod`, `.env`, secrets en clair — env runtime uniquement
- Ne jamais dire "ça devrait marcher" sans exécution — tout est terminal + logs collés dans PR
- Branch protection exige `database` vert (postgres:18) — `flutter-check` non requis, peut être rouge honnête
- Conventional Commits : `fix(mobile): ...`, `chore(lint): ...`, `docs(ops): ...`, `feat(admin): ...`
- Pas de force-push, pas de PR qui revert P3 (vérifier base = main @ 4804402)

## Prompt final à coller dans Cursor Agent Mode

```
Tu es Cursor, agent autonome avec accès filesystem, terminal, git, GitHub.

Contexte : Repo Allintelligence2024/cr-cheDZ, main @ 4804402 (PR #18 merged), CI postgres:18 + branch protection database required, stack NestJS 11.1 + React 19 + Flutter 3.47.1, GHCR images, migrations 001→052 immuables, 28/28 suites sur PG18 NOBYPASSRLS, garde config P1, Flutter CI honnête rouge (intl bump fait mais Drift g.dart manque).

État PRs : #13 old backup runbook OPEN à fermer, #19/#20/#21 CLOSED, #22 fix/mobile-intl-bump OPEN (intl ^0.20.3 mais flutter FAILURE), #23 chore/lint-burn-down-v2 OPEN (72→0), #8 OPEN build+run.

Lis docs/BACKUP-RUNBOOK.md, docs/OPERATIONS-SECRETS.md, docs/PILOT-PROTOCOL.md, docs/ANTIGRAVITY-MCP.md, docs/CURSOR-FINAL-MISSIONS.md, issue #8, PR #22, PR #23.

Tâches dans l'ordre :
1. Fermer #13 si docs déjà dans main via #18.
2. Rendre #22 vert : flutter pub get + analyze — si échec Drift g.dart, passer à 3.
3. Générer Drift g.dart : cd apps/staff-mobile && dart run build_runner build --delete-conflicting-outputs, commit g.dart, PR fix(mobile): generate Drift g.dart
4. Rendre #23 vert : npm ci && npm run lint (0 warnings) && typecheck && audit && database 28/28, puis merge.
5. Quand flutter CI verte (pub get && analyze && build), fermer #8.
6. Écrire docs/ANTIGRAVITY-RESULTS.md final avec tableau tâche→temps→preuve→statut.

Chaque PR avec preuves d'exécution (logs). Pas de force-push. Conventional Commits.
```
