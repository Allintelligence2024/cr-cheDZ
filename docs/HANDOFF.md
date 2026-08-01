# PASSATION — Prochaine session de développement

> Copiez ce document (ou son résumé) comme premier message de la prochaine
> conversation pour que l'agent sache exactement où reprendre et comment travailler.

---

## PROMPT DE CONTINUATION (à copier dans la prochaine conversation)

```
Continue le développement du logiciel de gestion de crèche (Algérie) dans le repo
cr-cheDZ, branche arena/019fbde5-cr-chedz (déjà mergée dans main — PR #1).

ÉTAT ACTUEL (validé sur PostgreSQL réel) :
- Phases 0-1 : monorepo, migrations 001-018 (RLS USING+WITH CHECK partout,
  sync_changelog, contraintes financières, helper app_tenant_id), runner de
  migrations avec checksums, GATE d'isolation RLS (8/8 tests)
- Phase 2 : auth JWT (access 15min + refresh rotatif 7j, détection de
  réutilisation, TOTP RFC6238), contexte tenant AsyncLocalStorage, audit
  avec masquage PII, migration 015 (fonctions SECURITY DEFINER)
- Phase 3 : organisations (super_admin), sites/salles, invitations (token
  signé 7j → acceptation), staff, admin-web React (i18n AR/FR RTL)
- Phase 4 : enfants/familles (permissions granulaires), import CSV/XLSX
  (dry-run + rapport FR/AR), reference_number par org (migration 017),
  staff-mobile (squelette Dart Drift, non compilé : pas de SDK Flutter)
- Phase 5 : machine à états de présence, /sync/push (idempotence event_id,
  appareil actif, heure ±5min) + /sync/pull (curseur sync_seq, lot 500),
  200 opérations offline testées
- Phase 6 : journal quotidien (actions groupées, corrections append-only),
  médias (presign S3/MinIO, consentement photo → 422 si absent/révoqué,
  accès journalisé), notifications (queue + inbox), worker (jobs
  FOR UPDATE SKIP LOCKED + drain FCM stub)

MÉTHODE DE TRAVAIL (non négociable) :
1. Fondation d'abord : le GATE (aucun accès cross-tenant) ne redevient JAMAIS
   rouge — chaque nouvelle ressource a son test d'isolation écrit AVANT le CRUD.
2. Migrations SQL numérotées, IMMUABLES après application (runner avec
   checksums, ADR-007). Toute évolution = nouvelle migration.
3. Tests API dans tests/tenant-isolation/phaseN.api.test.mjs, exécutés contre
   un vrai PostgreSQL avec le rôle NOBYPASSRLS (creche_app_test).
4. Contexte tenant : toute requête sur une table tenant passe par
   TenantContextService.withTenantConnection() (set_config app.tenant_id).
5. Messages d'erreur FR/AR partout (AppError + HttpExceptionFilter).
6. Une fonctionnalité est finie quand : tests verts + isolation testée +
   tsc --noEmit vert sur api/worker/admin-web/support-console + non-régressions.
7. Env de test : npm install dans /tmp/pgtest (embedded-postgres) — scripts
   run_generic.mjs / run_pN.mjs (ne pas committer, /tmp est éphémère).
8. Le SDK Flutter n'existe pas dans la sandbox : les ajouts mobile sont écrits
   en Dart mais non compilés — documenter dans apps/*-mobile/README.md.

PROCHAINE ÉTAPE — PHASE 7 (Application parents + notifications) :
- parent-mobile Flutter (squelette Dart comme staff-mobile) : auth OTP
  téléphone + PIN, fil du jour (feed), photos (URLs signées), signalement
  d'absence en 2 taps, consentements (revocation → effet immédiat),
  RTL arabe complet
- API parents : fondation Phase 7 ajoutée dans `modules/parents` : endpoints isolés `/parent/*` (enfants, fil via `child_guardians.can_view_journal`, absence, consentements, préférences/quiet hours, téléchargement photo visible). Il reste à écrire/exécuter la suite d'isolation parent complète, et à finaliser OTP email/SMS + PIN (table `otp_codes`).
- FCM réel dans le worker (fcm_token des devices) + APNs
- Tests : isolation parent (2 parents du même enfant avec permissions
  différentes), notification arrivée < 30s, RTL (golden tests)
- Puis Phase 8 (facturation : contrats, factures mensuelles, paiements
  espèces, PDF Puppeteer, caisse)

À NE PAS OUBLIER :
- .github/workflows/ existe localement mais n'est PAS poussé (permission
  GitHub App) → voir docs/CI-RESTORE.md (git add .github && commit && push)
- Après chaque phase : mettre à jour docs/PLAN_EXECUTION_PROCHAINES_PHASES.md
  et docs/PLAN_IMPLEMENTATION.md, puis commit + push + PR + merge (gh pr
  create --base main --head arena/019fbde5-cr-chedz ; gh pr merge --squash
  --delete-branch=false)
```

---

## État du dépôt (août 2026)

| Élément | État |
|---|---|
| Branche de travail | `arena/019fbde5-cr-chedz` (poussée, PR #1 mergé dans `main` — commit `5b9fcba`) |
| Migrations | 001 → 018 (schéma complet, RLS robuste `app_tenant_id()`) |
| Suites de tests | `tests/tenant-isolation/` : schema-check, rls-behavior-check (GATE 8/8), isolation.api (S2), phase3, phase4, phase5, phase6 — **toutes vertes** |
| CI | Workflows locaux non poussés (permission `workflows`) — `docs/CI-RESTORE.md` |
| Apps | api (NestJS), worker (boucle jobs), admin-web (React FR/AR), support-console (squelette), staff-mobile + parent-mobile (squelettes Dart) |
| Docs | `docs/PLAN_IMPLEMENTATION.md` (plan global), `docs/PLAN_EXECUTION_PROCHAINES_PHASES.md` (par phase), `docs/adr/` (ADR-000→010), `docs/HANDOFF.md` (ce fichier) |

## Commandes utiles

```bash
# Installer les dépendances (node_modules absent après restauration de session)
npm install --no-audit --no-fund

# Valider (avec un PostgreSQL : /tmp/pgtest/embedded-postgres + run_generic.mjs)
node scripts/migrate.mjs && node scripts/seed.mjs
node tests/tenant-isolation/schema-check.mjs && node tests/tenant-isolation/rls-behavior-check.mjs
node tests/tenant-isolation/phase6.api.test.mjs   # dernière suite

# Typechecks
cd apps/api && ../../node_modules/.bin/tsc --noEmit

# Restaurer la CI
git add .github && git commit -m "ci: restore workflows" && git push
```
