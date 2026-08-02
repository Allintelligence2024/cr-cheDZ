# PASSATION — Prochaine session de développement

> Copiez ce document (ou son résumé) comme premier message de la prochaine
> conversation pour que l'agent sache exactement où reprendre et comment travailler.

---

## PROMPT DE CONTINUATION (à copier dans la prochaine conversation)

```
Continue le développement du logiciel de gestion de crèche (Algérie) dans le repo
cr-cheDZ, sur la branche de session Arena active (cf. contexte Arena — ne jamais
changer ; si le HANDOFF cite une autre branche, importer l'état de la branche
citée dans la branche de session puis travailler dessus).

ÉTAT ACTUEL (validé sur PostgreSQL 18 réel, rôle applicatif NOBYPASSRLS) :
- 24/24 suites d'isolation vertes (schema-check, rls-behavior, isolation,
  phase3 → phase21 inclus) — ordre canonique rejouable.
- Migrations 001-048 immuables (ADR-007, runner à checksums).
- Phases 0-11 (fondations, auth, orgs, enfants, présences, journal, parents,
  facturation, admin-web, santé/conformité/vie privée/support, durcissement)
  + roadmap v2 phases 12-20 : messagerie, exports Excel, paiement en ligne
  SATIM, multi-rôles, WhatsApp (notifications + OTP parent), paie,
  marketplace, verrou DPIA vidéosurveillance.
- Stack : NestJS 11.1 + React 19 + react-router 8 + exceljs (xlsx retiré) ;
  npm audit --omit=dev = 0 vulnérabilité ; PDF bilingue AR (pdfkit + Noto
  Naskh Arabic embarquée).

FAIT en dernier (session août 2026) :
- Phase 19 — OTP via WhatsApp : migration 045 (otp_codes.channel), DTO
  channel (sms défaut), flag global whatsapp_otp (seed 014), 422
  WHATSAPP_OTP_DISABLED sans flag (bilingue), envoi réel API Graph hors test
  (503 WHATSAPP_NOT_CONFIGURED sans config — jamais de faux « envoyé »),
  roundtrip complet. Suite phase19-whatsapp-otp : 7 cas verts.
- Phase 20 — Vidéosurveillance : DPIA RÉDIGÉE
  (docs/regulatory/DPIA-VIDEOSURVEILLANCE.md, modèle FR + résumé AR) +
  verrou technique : migration 046 (processing_registry.requires_dpia,
  modèle « Vidéosurveillance des locaux » inactif, fonction SECURITY DEFINER
  privacy_approved_dpia_exists), garde-fou setFlag (422 DPIA_REQUIRED,
  activation globale interdite VIDEO_SURVEILLANCE_GLOBAL_FORBIDDEN,
  désactivation toujours libre). Suite phase20-video-dpia-gate : 8 cas verts.
- Phase 21 — MODULE vidéosurveillance V1 implémenté : caméras (zones
  blanches DPIA, CHECK base — jamais sanitaires/change/sieste/infirmerie),
  clips DVR/NVR (presign S3 comme les photos, backend local explicite),
  download signé + flux local avec VISIONNAGE JOURNALISÉ (audit read),
  purge worker à 30 j (stockage supprimé AVANT la ligne ; S3 injoignable →
  job failed VIDEO_PURGE_PARTIAL + réessai — jamais de fausse purge),
  écran admin-web VideoPage (notice conformité si flag off), i18n FR/AR.
  PAS de flux en direct (hors périmètre v1, documenté). Suite phase21 :
  8 cas verts. BUG RÉEL corrigé en route : jobs_finish échouait sur
  TOUT échec de job depuis la migration 024 (CASE text vs enum job_status)
  → migration 048 (cast) — le retry/failed des jobs refonctionne.
- .env.example / .env.prod.example : WHATSAPP_* et SATIM_* documentés.

RESTE À FAIRE (non fait, à ne pas déclarer fini) :
- PILOTE TERRAIN : 5 crèches réelles × 2 semaines, stores, DNS/TLS, device
  farm, FCM/APNs/SMS/WhatsApp réels, exercice de restauration, bilan go/no-go
  (docs/pilot/ — baseline pré-pilote dans docs/pilot/BILAN-PILOTE.md).
  C'est de l'HUMAIN + du TERRAIN : rien de codable ne manque.
- Workflows CI (.github/workflows/ci.yml + docker.yml) : prêts, NON poussés
  (permission `workflows` de la GitHub App manquante — voir docs/CI-RESTORE.md ;
  sondes du 2026-08-02 : toujours refusé).
- e2e Playwright (spec écrit, navigateur absent) ; k6 (script prêt, binaire absent).
- Notification ANPDP SMTP : implémentée, chemin 503 testé, pas testée de bout
  en bout (pas de SMTP).
- parent-mobile / staff-mobile Flutter : SDK absent → Dart écrit, jamais compilé.
- SMS OTP : Twilio implémenté mais NON CONFIGURÉ (SMS_UNAVAILABLE 503).
- FCM/APNs : chemins réels, non testés de bout en bout (pas de secrets).
- SATIM/WhatsApp prod : identifiants réels requis (SATIM_*, WHATSAPP_*).
- Écran admin-web violations/DPIA : non implémenté (API prête).

MÉTHODE DE TRAVAIL (non négociable) :
1. GATE d'isolation : test écrit AVANT le CRUD ; toute table tenant = RLS
   USING+WITH CHECK via app_tenant_id() ; requêtes via
   TenantContextService.withTenantConnection ; rôle NOBYPASSRLS.
2. Migrations numérotées immuables (checksums) ; toute évolution = nouvelle
   migration (CREATE OR REPLACE pour les fonctions).
3. PostgreSQL embedded : /tmp/pgtest (port 54329, base creche_test,
   postgres:postgres) — recréer si purgé : npm install embedded-postgres +
   run_pg.mjs start ; puis node scripts/migrate.mjs --reset && seed.
4. Worker : dist à rebuild après reset de session (cd apps/worker && rm -f
   tsconfig.tsbuildinfo && tsc -p tsconfig.json) — sinon phases 6/8/11/13/16
   échouent (spawn du worker).
5. Erreurs FR/AR via AppError ; jamais de faux statut (sent/notified/paid)
   sans livraison réelle ; secrets uniquement en env.
6. Une fonctionnalité est finie : tests verts + isolation + typecheck
   api/worker/admin-web/support-console + docs (HANDOFF/PLAN_EXECUTION/
   ROADMAP_V2) + Conventional Commit + push sur la branche de session.
7. Flutter : SDK absent — jamais prétendre une compilation sans build réel.
```

---

## État du dépôt (août 2026)

| Élément | État |
|---|---|
| Branche de travail | branche de session Arena active (historiquement `arena/019fbeff-cr-chedz`, puis `arena/019fc32c-cr-chedz`) — ne jamais changer |
| Migrations | 001 → 048 (schéma complet, RLS robuste `app_tenant_id()`, facturation bornée, webhook + jobs SECURITY DEFINER, paie, otp channel, vidéo post-DPIA, fix jobs_finish) |
| Suites de tests | `tests/tenant-isolation/` : schema-check, rls-behavior-check (GATE), isolation (S2), phase3 → phase21 — **24/24 vertes sur PostgreSQL 18 réel** |
| Phase 7 | Portail parent complet (API) — OTP/PIN, consentements, quiet hours, photos, FCM/APNs worker |
| Phase 8 | Facturation complète (API + worker) — contrats, factures, paiements, allocations, caisse, webhook, PDF bilingue AR, accès parent |
| Phase 9 | Admin web complète (API + écrans) — dashboard, présences, journal + modération, photos, facturation, fiche enfant, paramètres/tarifs, i18n AR/FR, lazy, responsive |
| Phase 10 | Santé, conformité 19-253, vie privée 25-11, console support (API + UI) — migrations 029-032, seeds 015 |
| Roadmap v2 | Messagerie, exports Excel, paiement SATIM, multi-rôles, WhatsApp (notif + OTP), paie, marketplace — phases 12-20 vertes |
| Conformité vidéo | DPIA rédigée + verrou flag `video_surveillance` (046) + module V1 : caméras/clips/purge 30 j/visionnage journalisé (047-048, phase21) |
| Apps | api (NestJS), worker (jobs + push + exports + PDF), admin-web (React FR/AR responsive), support-console, staff-mobile + parent-mobile (squelettes Dart) |
| CI | Workflows locaux non poussés (permission `workflows`) — `docs/CI-RESTORE.md` |
| Docs | `docs/PLAN_IMPLEMENTATION.md`, `docs/PLAN_EXECUTION_PROCHAINES_PHASES.md`, `docs/ROADMAP_V2.md`, `docs/adr/` (000→010), `docs/HANDOFF.md` (ce fichier) |

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
node tests/tenant-isolation/phase12-messaging.api.test.mjs
node tests/tenant-isolation/phase13-exports.api.test.mjs
node tests/tenant-isolation/phase14-online-payment.api.test.mjs
node tests/tenant-isolation/phase15-multirole.api.test.mjs
node tests/tenant-isolation/phase16-whatsapp.api.test.mjs
node tests/tenant-isolation/phase17-payroll.api.test.mjs
node tests/tenant-isolation/phase18-marketplace.api.test.mjs
node tests/tenant-isolation/phase19-whatsapp-otp.api.test.mjs
node tests/tenant-isolation/phase20-video-dpia-gate.api.test.mjs
node tests/tenant-isolation/phase21-video-surveillance.api.test.mjs

# Typechecks
npm run typecheck --workspace @creche/api
npm run typecheck --workspace @creche/worker
npm run typecheck --workspace @creche/admin-web
npm run typecheck --workspace @creche/support-console

# Restaurer la CI
git add .github && git commit -m "ci: restore workflows" && git push
```
