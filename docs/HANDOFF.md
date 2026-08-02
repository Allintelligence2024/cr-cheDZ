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
  console + écrans web santé/conformité) : module health (dossier, allergies,
  vaccinations, médicaments double saisie, accès parent can_view_health),
  compliance 19-253 (checks persistés + capacité enforceée 409), privacy 25-11
  (demandes + export JSON, violations chrono 5 j ANPDP, DPIA, registre seedé),
  console support (recherche, impersonation auditée, jobs retry, feature
  flags) — migrations 029-032, 035.
- Phase 11 (durcissement) TERMINÉE : /metrics Prometheus public (sans PII),
  rétention 5 ans (migration 034 + job retention_purge), index Phase 11
  (migration 033), idempotence mensuelle testée, healthcheck public corrigé,
  npm audit durci, écrans admin-web Santé/Conformité, feature flags console,
  scripts ops (backup.sh, anonymize.sql), RUNBOOK, k6 script, SECURITY.md.
- Phase 12 (pilotes) OUTILLAGE TERMINÉ : seed 5 crèches pilotes
  (scripts/pilot/seed-pilot.mjs), benchmark MVP 4/4 sur PostgreSQL réel
  (tests/load/mvp-bench.mjs : pointage 12 enfants 0,09 s, repas groupé
  0,04 s, facture 0,008 s, import 50 enfants 0,06 s), rapport de préparation
  (scripts/pilot/pilot-report.mjs → docs/pilot/RAPPORT-PREPARATION.md,
  19/19 checks, 7/10 MVP pass), jauges pilote dans /metrics
  (creche_children_active, creche_checkins_today, creche_sync_ops_24h,
  creche_jobs_failed_24h, creche_http_5xx_24h), onboarding + checklist +
  QR de partage + roadmap v2 + runbook §8 + template de bilan.
  EXÉCUTION TERRAIN restante : 5 crèches × 2 semaines, stores, DNS/TLS,
  device farm, FCM/APNs/SMS réels, exercice de restauration chronométré.

MISE À JOUR 2026-08-02 (durcissement + roadmap v2) :
- NestJS 11.1.28 + React 19 + react-router 8.3.0 + exceljs (xlsx retiré) +
  uuid 11 (override) → `npm audit --omit=dev` = **0 vulnérabilité** ;
  15/15 suites vertes sous la nouvelle stack.
- Sécurité : OTP via crypto.randomInt (Math.random retiré, détecté par
  semgrep local), lien d'invitation (jeton) non journalisé.
- Infra provisioning : docker-compose.prod.yml réécrit (prometheus, grafana
  + dashboard, postgres-exporter, admin-web/support-console, backup GPG),
  nginx.conf TLS + rate limiting, .env.prod.example complet,
  infra/monitoring/grafana/dashboards/creche.json, Dockerfile support-console.
- Sentry : @sentry/node (api+worker) et @sentry/react (admin-web), actifs
  uniquement avec SENTRY_DSN/VITE_SENTRY_DSN.
- Suivi pilote : migration 036+037 support_pilot_summary() + GET /support/
  pilot-summary + onglet « Suivi pilote » console (vérifié : 5 crèches,
  75 enfants).
- Roadmap v2 : MESSAGERIE (API + écran web), EXPORTS EXCEL (API + écran
  web), VIE PRIVÉE écran web (registre, DPIA, demandes, violations),
  PDF BILINGUE AR (pdfkit + Noto Naskh embarquée), PAIEMENT EN LIGNE
  CIB/Edahabia (adaptateur SATIM, migration 039 : le webhook confirme
  désormais un paiement pending) — phases 12-14 (7+8+8 cas) vertes ;
  17 suites au total. Production : config SATIM_* requise (non fournie).

RESTE À FAIRE (non fait, à ne pas déclarer fini) :
- PILOTE TERRAIN : 5 crèches réelles × 2 semaines, stores, DNS/TLS, device
  farm, FCM/APNs/SMS réels, exercice de restauration, bilan go/no-go
  (tout l'outillage est prêt et testé — cf. docs/pilot/ ; baseline pré-pilote
  consignée dans docs/pilot/BILAN-PILOTE.md).
- Workflows CI (.github/workflows/ci.yml + docker.yml) : prêts dans le dépôt
  local, NON commités ni poussés (la GitHub App n'a pas la permission
  `workflows` — push refusé). Restaurer : git add .github apps/worker/Dockerfile
  && commit && push (voir docs/CI-RESTORE.md). L'e2e Playwright et CodeQL ne
  tourneront qu'une fois les workflows poussés.
- e2e Playwright : spec écrit (phase 9), non exécuté (pas de navigateur).
- k6 : script écrit (tests/load/sync.k6.js), non exécuté (k6 absent).
- Notification ANPDP : SMTP (nodemailer 9) implémenté, non testé de bout en
  bout (pas de SMTP dans la sandbox — chemin 503 testé).
- Écran admin-web violations/DPIA : non implémenté (API prête).
- Migration NestJS 11 (résidus npm audit) : planifiée post-MVP (SECURITY.md).
- Sentry, Grafana, cron de backup, exercice de restauration chronométré : à
  mettre en place avec l'infrastructure réelle.
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
node tests/tenant-isolation/phase11-hardening.api.test.mjs

# Typechecks
npm run typecheck --workspace @creche/api
npm run typecheck --workspace @creche/worker
npm run typecheck --workspace @creche/admin-web
npm run typecheck --workspace @creche/support-console

# Restaurer la CI
git add .github && git commit -m "ci: restore workflows" && git push
```
