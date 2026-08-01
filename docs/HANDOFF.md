# PASSATION — Prochaine session de développement

> Copiez ce document (ou son résumé) comme premier message de la prochaine
> conversation pour que l'agent sache exactement où reprendre et comment travailler.

---

## PROMPT DE CONTINUATION (à copier dans la prochaine conversation)

```
Continue le développement du logiciel de gestion de crèche (Algérie) dans le repo
cr-cheDZ, branche arena/019fbeff-cr-chedz (branche de travail de la session).

ÉTAT ACTUEL (validé sur PostgreSQL 18 réel, rôle applicatif NOBYPASSRLS) :
- Phases 0-6 : fondations (migrations 001-018 RLS robuste), auth JWT/TOTP,
  organisations/invitations/staff, enfants/import, présences + sync offline,
  journal/médias/notifications — toutes suites vertes.
- Phase 7 (API + worker) TERMINÉE : portail /parent/* (feed, absence,
  consentements à révocation immédiate, préférences + quiet hours, photos
  signées), OTP téléphone + PIN (migration 025 : auth_parent_lookup_by_phone
  SECURITY DEFINER — bug RLS réel corrigé), worker FCM HTTP v1 + APNs direct.
  Suite phase7-parent.api.test.mjs : 11/11 cas verts.
- Phase 8 (API + worker) TERMINÉE : contrats, génération mensuelle idempotente
  (index 021 + job send_monthly_invoices), paiements espèces + allocations
  (bornes trigger 023), caisse quotidienne, reçus, webhook signé HMAC idempotent
  (migration 024 billing_webhook_apply SECURITY DEFINER), PDF facture généré par
  le worker (écrivain PDF réel, backend local ou S3 explicite), accès parent
  lecture seule (can_receive_invoices). Suite phase8-billing.api.test.mjs :
  16/16 cas verts. Migrations 024-028 (jobs_claim_next/jobs_finish pour le
  worker sous NOBYPASSRLS, corrigées 026-028).
- Phase 9 (admin web) TERMINÉE (API + écrans) : GET /dashboard/summary
  (présences/jour + alertes, module dashboard), PATCH /journal/events/:id/visibility
  (modération directrice, note privée → 422), GET /children/:id enrichi
  (room_moves + status_history), écrans admin-web Dashboard/Attendance/Journal/
  Media/Billing/OrgSettings + fiche enfant + ~150 clés i18n AR/FR, lazy loading
  (bundle 63,7 kB gzip). Suite phase9-dashboard.api.test.mjs : 7 cas (22
  assertions) verts. E2E Playwright écrit (director-flow) mais NON exécuté.

- Phase 10 (santé, conformité, vie privée, console support) TERMINÉE (API +
  console) : module health (dossier, allergies, vaccinations, médicaments
  double saisie, accès parent can_view_health), compliance 19-253 (checks
  persistés + capacité enforceée 409 création/import), privacy 25-11
  (demandes de droits + export JSON, violations chrono 5 j ANPDP, DPIA,
  registre seedé 015), console support (recherche globale, impersonation
  auditée, jobs retry) — migrations 029-032. Suites phase10 (santé 11,
  conformité 7, privacy/support 11) vertes.

RESTE À FAIRE (non fait, à ne pas déclarer fini) :
- Phase 9 e2e Playwright : spec + config écrits (login → pointage → facture),
  NON exécutés (navigateur Playwright non installable dans la sandbox) ;
  exécuter en CI (job e2e) : node scripts/migrate.mjs && seed-e2e.mjs puis
  npx playwright test dans apps/admin-web.
- Notification ANPDP : SMTP réel (nodemailer) implémenté mais non testé de
  bout en bout (pas de SMTP dans la sandbox — chemin 503 testé).
- Rétention/purge des logs (5 ans) : job non implémenté.
- Écrans admin-web santé/conformité/violations : non implémentés (API prête).
- Messagerie (backend + écran web) : non implémentée.
- parent-mobile / staff-mobile Flutter : SDK absent → code Dart écrit mais
  `flutter analyze`, widget tests et golden RTL NON exécutés.
- SMS OTP : Twilio implémenté mais déclaré NON CONFIGURÉ (SMS_UNAVAILABLE 503).
- FCM/APNs : chemins de code réels, non testés de bout en bout (pas de secrets).
- PDF bilingue AR (composition arabe), exports Excel (stubs NOT_IMPLEMENTED).
- job send_monthly_invoices : implémenté, pas de test dédié.
- Prochaine phase logique : Phase 10 (santé, conformité, console support, vie
  privée) — voir docs/PLAN_IMPLEMENTATION.md.

MÉTHODE DE TRAVAIL (non négociable) :
1. Fondation d'abord : le GATE (aucun accès cross-tenant) ne redevient JAMAIS
   rouge — chaque nouvelle ressource a son test d'isolation écrit AVANT le CRUD.
2. Migrations SQL numérotées, IMMUABLES après application (runner avec
   checksums, ADR-007). Toute évolution = nouvelle migration.
3. Tests API dans tests/tenant-isolation/phaseN.api.test.mjs, exécutés contre
   un vrai PostgreSQL avec le rôle NOBYPASSRLS (creche_app_test, ensureAppRole
   dans helpers.mjs — GRANT USAGE ON SCHEMA public OBLIGATOIRE après reset).
4. Contexte tenant : toute requête sur une table tenant passe par
   TenantContextService.withTenantConnection() (set_config app.tenant_id).
5. Messages d'erreur FR/AR partout (AppError + HttpExceptionFilter).
6. Une fonctionnalité est finie quand : tests verts + isolation testée +
   tsc --noEmit vert sur api/worker/admin-web/support-console + non-régressions.
7. Env de test : /tmp/pgtest (embedded-postgres, port 54329, base creche_test,
   postgres:postgres) — scripts temporaires jamais committés.
   Commandes : DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/creche_test
   RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local
   STORAGE_LOCAL_DIR=/tmp/pgtest/pdfstore PAYMENT_WEBHOOK_SECRET=phase8-test-secret
8. Les suites phase7/phase8 font --reset au démarrage et nettoient leurs orgs à
   la fin (même pattern que phase4-6) : l'ordre canonique de validation est
   rejouable sur une base propre.
9. Le SDK Flutter n'existe pas dans la sandbox : les ajouts mobile sont écrits
   en Dart mais non compilés — documenter dans apps/*-mobile/README.md.
```

---

## État du dépôt (août 2026)

| Élément | État |
|---|---|
| Branche de travail | `arena/019fbeff-cr-chedz` (session Arena — ne jamais changer) |
| Migrations | 001 → 028 (schéma complet, RLS robuste `app_tenant_id()`, facturation bornée, webhook + jobs SECURITY DEFINER) |
| Suites de tests | `tests/tenant-isolation/` : schema-check, rls-behavior-check (GATE), isolation (S2), phase3 → phase8 — **toutes vertes sur PostgreSQL 18 réel** (phase7 : 11 cas, phase8 : 16 cas) |
| Phase 7 | Portail parent complet (API) — OTP/PIN, consentements, quiet hours, photos, FCM/APNs worker |
| Phase 8 | Facturation complète (API + worker) — contrats, factures, paiements, allocations, caisse, webhook, PDF, accès parent |
| Phase 9 | Admin web complète (API + écrans) — dashboard, présences, journal + modération, photos, facturation, fiche enfant, paramètres/tarifs, i18n AR/FR, lazy (63,7 kB gzip) |
| Phase 10 | Santé, conformité 19-253, vie privée 25-11, console support (API + UI) — migrations 029-032, seeds 015 |
| Apps | api (NestJS), worker (jobs + push), admin-web (React FR/AR), support-console (squelette), staff-mobile + parent-mobile (squelettes Dart) |
| CI | Workflows locaux non poussés (permission `workflows`) — `docs/CI-RESTORE.md` |
| Docs | `docs/PLAN_IMPLEMENTATION.md`, `docs/PLAN_EXECUTION_PROCHAINES_PHASES.md`, `docs/adr/` (000→010), `docs/HANDOFF.md` (ce fichier) |

## Commandes utiles

```bash
# Base de test : PostgreSQL embedded (déjà installé dans /tmp/pgtest)
#   cd /tmp/pgtest && node run_pg.mjs start   (port 54329, base creche_test)

# Valider (dans l'ordre canonique, base propre au préalable)
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54329/creche_test"
export RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local \
  STORAGE_LOCAL_DIR=/tmp/pgtest/pdfstore PAYMENT_WEBHOOK_SECRET=phase8-test-secret
node scripts/migrate.mjs --reset && node scripts/seed.mjs
node tests/tenant-isolation/schema-check.mjs
node tests/tenant-isolation/rls-behavior-check.mjs
node tests/tenant-isolation/isolation.api.test.mjs
node tests/tenant-isolation/phase3.api.test.mjs
node tests/tenant-isolation/phase4.api.test.mjs
node tests/tenant-isolation/phase5.api.test.mjs
node tests/tenant-isolation/phase6.api.test.mjs
node tests/tenant-isolation/phase7-parent.api.test.mjs
node tests/tenant-isolation/phase8-billing.api.test.mjs
node tests/tenant-isolation/phase9-dashboard.api.test.mjs
node tests/tenant-isolation/phase10-health.api.test.mjs
node tests/tenant-isolation/phase10-compliance.api.test.mjs
node tests/tenant-isolation/phase10-privacy.api.test.mjs

# Typechecks
npm run typecheck --workspace @creche/api
npm run typecheck --workspace @creche/worker
npm run typecheck --workspace @creche/admin-web
npm run typecheck --workspace @creche/support-console

# Restaurer la CI
git add .github && git commit -m "ci: restore workflows" && git push
```
