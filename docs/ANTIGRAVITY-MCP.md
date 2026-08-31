# ANTIGRAVITY — Human Ops via MCP (Model Context Protocol)

> Ce fichier est le prompt complet pour Antigravity (Google) + MCP pour exécuter le travail humain restant après P3. Il transforme les tâches "opérationnelles/humaines" en actions traçables via outils MCP.

## Contexte à charger dans Antigravity

```
Tu es Antigravity, agent autonome avec accès MCP : filesystem, github, postgres, shell, browser, vault.

Repo : Allintelligence2024/cr-cheDZ
Main @ bff4c99 (PR #12 merged) — CI verte obligatoire : postgres:18 + branch protection exige job database
Stack : NestJS 11.1 + React 19 + Flutter 3.47.1 (stable) + GHCR ghcr.io/creche-saas/{api,worker,admin-web,support-console}:latest+SHA
Migrations 001→052 immuables, 28/28 suites isolation (schema-check, rls-behavior, isolation, phase3→phase24) sur PG18 réel NOBYPASSRLS
Garde config P1 : @creche/prod-config (PAYMENT_WEBHOOK_SECRET≥32, JWT_SECRET≥32≠dev, STORAGE, SATIM complet ou 0)
Flutter CI : maintenant honnête rouge (intl ^0.19.0 vs ^0.20.3) — voir issue #8
```

## MCP Servers à activer

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/cr-cheDZ"] },
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" } },
    "postgres": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"], "env": { "DATABASE_URL": "${DATABASE_URL}" } },
    "shell": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-shell"] },
    "puppeteer": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }
  }
}
```

## Mission 1 — BACKUP RESTORE (<30 min, staging)

**Fichier** : `docs/BACKUP-RUNBOOK.md` (créé PR #13)

**MCP steps** :
1. `filesystem:read` `scripts/backup.sh` + `docs/RUNBOOK.md §2/§5`
2. `shell:exec` `ls -lt /var/backups/creche/daily/` (ou `/tmp/restore-test`)
3. Créer VM clean (Docker) : `shell:exec` `docker run -d --name pg-restore -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:18`
4. `shell:exec` `gpg --batch --decrypt --passphrase $BACKUP_PASSPHRASE $BACKUP | gunzip | psql $DATABASE_URL_RESTORE`
5. `shell:exec` `DATABASE_URL=$RESTORE node scripts/migrate.mjs --check` → doit être vert
6. `shell:exec` `bash scripts/run-isolation-suites.sh` (échantillon 28/28)
7. `filesystem:write` `docs/pilot/BILAN-PILOTE.md` § Exercice restauration : temps, taille, verdict
8. `github:create_issue` si échec, ou `github:create_pr` avec runbook mis à jour

**Critère** : 2 restores <30min par 2 personnes différentes, log conservé.

## Mission 2 — SECRETS RÉELS (SATIM, WhatsApp, FCM/APNs, SMTP)

**Fichier** : `docs/OPERATIONS-SECRETS.md`

**MCP steps** :
1. `filesystem:read` `packages/prod-config/src/index.ts` (garde P1)
2. `shell:exec` `NODE_ENV=production node -e "require('./packages/prod-config/dist').assertProductionConfig()"` → doit lister manquants
3. Via `vault` MCP (ou 1Password) : récupérer `SATIM_MERCHANT_ID`, `SATIM_SECRET`, `SATIM_GATEWAY_URL` (sandbox d'abord), `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `APNS_*`, `SMTP_*`
4. `filesystem:write` `.env.prod` (jamais commité, `.gitignore` OK) depuis `.env.prod.example`
5. `shell:exec` `NODE_ENV=production PAYMENT_WEBHOOK_SECRET=... JWT_SECRET=... node apps/api/dist/main.js` → doit afficher `API prête`
6. Test SATIM : `shell:exec` init paiement pending → `payments_expire` job → webhook tardif (phase24)
7. Test WhatsApp : `shell:exec` `POST /support/flags/whatsapp_otp` + OTP sans flag → 422 `WHATSAPP_OTP_DISABLED`
8. `github:create_pr` avec `docs/OPERATIONS-SECRETS.md` mis à jour (sans secrets en clair, seulement procédure)

## Mission 3 — PILOTE TERRAIN 5 crèches x 2 semaines

**Fichiers** : `docs/PILOT-PROTOCOL.md` + `docs/pilot/CHECKLIST_PILOTE.md` + `docs/pilot/BILAN-PILOTE.md`

**MCP steps** :
1. `shell:exec` `node scripts/pilot/seed-pilot.mjs` (5 crèches, 3 salles, 15 enfants)
2. `shell:exec` `node scripts/pilot/pilot-report.mjs --bench` → `docs/pilot/RAPPORT-PREPARATION.md`
3. `filesystem:read` `docs/PILOT-PROTOCOL.md` + `docs/pilot/CHECKLIST_PILOTE.md`
4. Via `puppeteer` : ouvrir `admin-web` (port 4000), vérifier pointage <3min, journal, photos
5. Simuler offline 8h : `shell:exec` `bash tests/tenant-isolation/phase5.api.test.mjs` (200 ops offline)
6. Chaque jour : `shell:exec` `curl /api/v1/metrics | grep creche_` → remplir checklist
7. Incidents : `filesystem:write` `docs/pilot/CHECKLIST_PILOTE.md` § Irritants
8. Fin J14 : `filesystem:write` `docs/pilot/BILAN-PILOTE.md` + go/no-go, `github:create_pr`

## Mission 4 — Dettes codables mineures (issues #8 suite)

**Fichiers** : `apps/parent-mobile/pubspec.yaml` (intl), `apps/staff-mobile/lib/core/database/app_database.dart` (Drift)

**MCP steps** (une PR par dette, ne pas mélanger) :

### 4a. Flutter intl bump (parent-mobile)
1. `filesystem:read` `apps/parent-mobile/pubspec.yaml` → `intl: ^0.19.0`
2. `filesystem:edit` → `intl: ^0.20.3` (ou `^0.20.0` selon `flutter_localizations` SDK)
3. `shell:exec` `cd apps/parent-mobile && flutter pub get && flutter analyze`
4. `github:create_pr` `fix(mobile): bump intl ^0.20.3 for flutter_localizations` + link #8

### 4b. Drift build_runner (staff-mobile)
1. `shell:exec` `cd apps/staff-mobile && dart run build_runner build --delete-conflicting-outputs`
2. Vérif `app_database.g.dart` généré
3. `shell:exec` `flutter analyze`
4. `github:create_pr` `fix(mobile): generate Drift app_database.g.dart`

### 4c. Lint burn-down 72 → 0
1. `shell:exec` `npm run lint 2>&1 | grep -oE "[0-9]+ problems"`
2. Fix warnings par lot (any → unknown, etc.), baisser `--max-warnings` dans `package.json` (monotone décroissant)
3. `github:create_pr` `chore(lint): burn-down warnings 72→XX`

### 4d. Écran admin DPIA/violations
1. `filesystem:read` `apps/api/src/modules/privacy/privacy.service.ts` (API prête)
2. Implémenter `apps/admin-web/src/pages/PrivacyPage.tsx` + `CompliancePage.tsx` (liste violations, DPIA)
3. `shell:exec` `npm run typecheck --workspace @creche/admin-web && npm run build --workspace @creche/admin-web`
4. `github:create_pr` `feat(admin): DPIA/violations screen`

## Règles non négociables (Antigravity doit respecter)

- Ne jamais modifier migrations 001-052 (immuables ADR-007)
- Ne jamais bypass RLS — `node scripts/check-rls-usage.mjs` doit rester vert
- Ne jamais committer `.env.prod` ou secrets en clair — env runtime uniquement
- Ne jamais dire "ça devrait marcher" sans exécution — tout est `shell:exec` + logs
- Branch protection exige `database` vert (postgres:18) — `flutter-check` est non requis, peut être rouge honnête

## Livrables attendus par Antigravity

1. PR `docs: backup runbook + restore exercise <30min` → merge
2. PR `docs: operations secrets + P1 guard proof` → merge (sans secrets)
3. PR `docs: pilot protocol + checklist + bilan` → merge
4. PRs codables : `fix(mobile): intl bump`, `fix(mobile): drift g.dart`, `chore(lint): burn-down`, `feat(admin): DPIA/violations`
5. Issue #8 fermée quand `flutter pub get && flutter analyze && flutter build` vert
6. Fichier final `docs/ANTIGRAVITY-RESULTS.md` avec tableau : tâche → temps → preuve → statut

## Prompt final pour Antigravity

```
Tu es Antigravity, tu as MCP filesystem/github/postgres/shell/puppeteer/vault.

Lis docs/BACKUP-RUNBOOK.md, docs/OPERATIONS-SECRETS.md, docs/PILOT-PROTOCOL.md, docs/ANTIGRAVITY-MCP.md, issue #8, PR #12.

Exécute Mission 1 (backup restore <30min) en premier, car c'est le seul P0 opérationnel avant pilote. Chronomètre, documente, PR, merge.

Puis Mission 2 (secrets réels) : utilise vault MCP, teste garde P1, jamais de secret en clair dans Git.

Puis Mission 3 (pilote) : seed 5 crèches, bench, checklist quotidienne via metrics.

Puis Mission 4 (dettes codables) : une PR par dette, typecheck + build + lint + audit + 28/28 suites.

Chaque PR doit avoir preuves d'exécution (logs collés). Pas de force-push. Conventional Commits.

Quand tout est vert, écris docs/ANTIGRAVITY-RESULTS.md et ouvre PR finale.
```
