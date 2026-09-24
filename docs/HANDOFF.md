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
- AUDIT EXTERNE CORRIGÉ + PROUVÉ (défaut majeur paiement + stockage vidéo,
  cf. § « Audit externe » ci-dessous) : fix P0 billing (withTenantConnection
  + assertion rowCount), politique serveur vidéo (préfixe tenant, anti-..,
  backend serveur seul, local interdit en prod), gardes resolve/containment
  (API + worker), migration 049 (CHECK storage_key) + 050 (métriques
  SECURITY DEFINER), suite phase22 (41 assertions, prouvée PAR MUTATION),
  garde anti-bypass RLS scripts/check-rls-usage.mjs (le P0 serait mort né),
  schema-check renforcé (FORCE RLS + policy + ancrage tenant), eslint réel
  (0 erreur), 3 tests unitaires jest payment-provider.
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

— MISSION P2 (session août 2026, cr-cheDZ) : webhook tardif + garde RLS catalogue + ratchet lint —
- **Webhook tardif (le point le plus important) — suite phase24 (21 assertions,
  TDD + preuve PAR MUTATION scripts/mutation-phase24-proof.sh)** :
  vérifié sur PostgreSQL 18 réel NOBYPASSRLS —
  1) un paiement en ligne passé 'failed' par EXPIRATION (backdate 73 h +
     worker payments_expire) qui reçoit PUIS son webhook signé valide est
     confirmé honnêtement : paiement 'confirmed', ALLOCATION créée, facture
     SOLDÉE (l'argent est réellement arrivé — jamais de rejet silencieux) ;
     le rejeu du webhook reste idempotent (1 paiement, 1 allocation) ;
  2) un paiement SUPERSEDED_BY_NEW_INIT (deux external_references distinctes
     R1/R2) : le webhook tardif de R1 (le BON paiement, celui sur lequel
     l'argent est tombé) confirme R1 et alloue sur la facture via R1 — R2
     reste intact (pending, aucune allocation : pas de double paiement) ;
     le webhook tardif de R2 (le mauvais) est REFUSÉ explicitement (422
     INVOICE_IMMUTABLE, facture déjà soldée) ;
  3) **défaut réel corrigé — migration 052** (CREATE OR REPLACE de
     billing_webhook_apply, 001-051 immuables) : avant, un webhook dont le
     MONTANT ≠ du montant du paiement confirmait SILENCIEUSEMENT au montant
     du paiement (webhook 9999 → facture de 10000 soldée, aucun écrit) ;
     désormais REFUS explicite 422 PAYMENT_AMOUNT_MISMATCH (mapping FR/AR
     dans billing.service.ts) — le paiement reste tel quel, un humain
     rapproche. Avant/après : « que fait un webhook tardif aujourd'hui ? »
     → AVANT : confirmation honnête du paiement expiré/supersédé (déjà le cas
     via 039 qui couvre le statut 'failed') MAIS montant du webhook ignoré
     silencieusement ; APRÈS : idem + refus explicite du montant incohérent.
- **Garde RLS auto-synchronisée (scripts/check-rls-usage.mjs)** : la
  whitelist SECURITY DEFINER n'est PLUS codée en dur — en mode CATALOGUE
  (DATABASE_URL défini : CI job database + runner d'isolation), elle est
  DÉRIVÉE de pg_proc WHERE prosecdef (schéma public) au moment du check ;
  les tables système restent une liste EXPLICITE mais CROISÉE avec pg_class
  (relrowsecurity=false) : tout écart catalogue/listes = ÉCHEC explicite
  (fonction figée disparue, table figée désormais RLS, fonction appelée via
  pool brute qui existe sans être SECURITY DEFINER). Mode sans base = listes
  figées + AVERTISSEMENT. Preuves rejouées : garde verte sur main (61 accès)
  + 3 tests négatifs (fonction inconnue → violation ; fonction non-SD
  (app_tenant_id) → divergence ; table figée à RLS active → divergence,
  rc=1).
- **Ratchet lint** : `npm run lint` = `eslint . --max-warnings=72` (compte
  du 2026-08-25 : 0 erreur / 72 warnings — le compte ne peut plus
  AUGMENTER). BURN-DOWN : éteindre des warnings puis BAISSER le seuil dans
  package.json — `npm run lint 2>&1 | grep -oE '[0-9]+ problems'` (ou la
  ligne « N problems ») donne le compte courant ; mettre
  `--max-warnings=<nouveau compte>` dans package.json ; le seuil est
  MONOTONE DÉCROISSANT (0 nouvelle erreur, 0 nouveau warning).
- Validation ÉTAPE 4 : `bash scripts/run-isolation-suites.sh` → 28/28
  (garde RLS + 27 suites dont phase24), npm run test:unit, npm run lint
  (72 ≤ 72), typecheck 4 apps, npm audit --omit=dev = 0, migrate --status
  001→052 — cf. rapport de mission (à rejouer avant tout merge).

— MISSION P1 (session août 2026, cr-cheDZ) : expiration pending + garde config —
- Paiement en ligne : un pending SATIM > 72 h passe en 'failed' avec
  gateway_response || {"expired":true,"reason":"PENDING_EXPIRED_72H"} via le
  job GLOBAL `payments_expire` (worker, pattern video_clips_purge) — JAMAIS de
  suppression (traçabilité compta), idempotent, échec SQL → job failed.
  À l'init (createOnlinePayment), les pending SATIM antérieurs de la MÊME
  facture passent en 'failed' (SUPERSEDED_BY_NEW_INIT) AVANT l'INSERT → un
  seul pending actif par facture, facture jamais « payée » par ce biais.
- Migration 051 : payments.invoice_id (FK ON DELETE SET NULL, nécessaire car
  les payments n'avaient AUCUN lien facture — un pending d'init n'a pas
  d'allocation) + index partiels (status,created_at / invoice_id,status)
  WHERE pending+satim + fonction SECURITY DEFINER payments_expire_pending().
- Garde de config au boot (module partagé @creche/prod-config, API + worker,
  uniquement NODE_ENV=production) : PAYMENT_WEBHOOK_SECRET <32 ou absent ;
  JWT_SECRET <32/absent/égal au défaut dev (l'auth JwtModule retombait sur
  `dev_jwt_secret_change_in_prod_minimum_32_chars` — inspection confirmée,
  JWT_REFRESH_SECRET non utilisé) ; S3 minio_dev/minio_dev_password ;
  local /tmp/creche-pdf ; SATIM partiel. Message explicite par variable.
  Inactive en test/dev. 8 tests unitaires jest dédiés (12 au total).
- Phase 23 — tests/tenant-isolation/phase23-pending-expiry.api.test.mjs
  (23 assertions : worker 72 h + idempotence + supersede init + isolation B ;
  preuve PAR MUTATION : script scripts/mutation-phase23-proof.sh — M1 worker
  réverté → 6 assertions ROUGES, M2 supersede réverté → 3 ROUGES, M3 051
  retirée → ROUGE (colonne/fonction absentes), restaurations VERTES).
- phase22 modifié UNIQUEMENT pour fournir secrets ≥ 32 au spawn production de
  la garde (test 5b isolé sur STORAGE_POLICY — justification commentée, aucun
  affaiblissement, 41 assertions inchangées) ; helpers.mjs : GRANT conditionnel
  de payments_expire_pending (pour la mutation M3) ; ci.yml inchangé : le
  build de @creche/prod-config est enchaîné comme PREBUILD des builds
  api/worker (la GitHub App n'a pas la permission workflows — docs/CI-RESTORE.md).

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

## Audit externe — correctifs PROUVÉS (session 2026-08-23)

Contexte : un audit statique (docs/PROMPT_AUDIT.md) avait trouvé 1 défaut
majeur paiement + 2 moyens (stockage vidéo) + 3 faibles. Une première
session de correction avait produit 7 fichiers modifiés + ci.yml mais SANS
AUCUNE exécution (npm ci expiré) et son env a été PERDU (jamais poussé) —
les correctifs ont été réappliqués selon la spécification
(docs/PROMPT_FIX_AUDIT.md), puis EXÉCUTÉS et PROUVÉS.

### Tableau finding → preuve (mutation ROUGE → VERT) → statut

| # | Finding (audit) | Correctif | Test phase22 (ROUGE prouvé par mutation → VERT) | Statut |
|---|---|---|---|---|
| P0 | Init paiement succès : UPDATE payments via pool brute → 0 ligne silencieuse sous NOBYPASSRLS, gateway_response jamais persistée | withTenantConnection + assertion rowCount!==1 → 500 PAYMENT_STATE_ERROR FR/AR ; injection pool brute retirée | « gateway_response PERSISTÉE » + « rowCount=0 → 500 » — ROUGE en révertant payment-provider.service.ts (gateway_response=null, 201 silencieux) | ✅ CORRIGÉ |
| V1 | storage_key client : `..` accepté (DTO), pas de préfixe tenant, pas de CHECK DB | Regex DTO anti-`..` + politique serveur `${tenantId}/video/` + migration 049 (CHECK 4 tables) | « clés hostiles → 4xx avant disque » (7 tests rouges en M2b dto+service révertés) + « CHECK migration 049 » (rouge sans 049 : 0/3 rejets) | ✅ CORRIGÉ |
| V2 | storage_backend client pris tel quel ; `local` possible en prod | Backend dérivé UNIQUEMENT de STORAGE_BACKEND serveur (champ DTO @deprecated ignoré) ; local → 422 STORAGE_POLICY si NODE_ENV=production (spawn dédié) | « Colonne = réalité SERVEUR » + « local en production → 422 » — ROUGE en révertant video.service.ts (col=s3, 201 en prod) | ✅ CORRIGÉ |
| F1 | Aucun resolve/containment avant lecture fichier (API vidéo, exports, worker purge) | resolve() + startsWith(root+sep) partout + préfixe tenant (streamContent, download) + worker localPath() (storeFile/deleteFile) | « Flux du clip empoisonné → 4xx, AUCUN octet lu » (pré-fix : octets du tenant B SERVIS, status 200) + « download export empoisonné » (pré-fix : leaked=true) + §7 worker (pré-fix : écriture hors racine) | ✅ CORRIGÉ |
| F2 | Commentaire anti-énumération mensonger + login pending non documenté | Commentaires corrigés (message unifié = la protection ; recordFailedAttempt(null)=no-op ; pending = choix produit) | Non comportemental (doc) — revu dans chore(auth,health,exports) | ✅ CORRIGÉ |
| F3 | 7 dto:any + (wb as any).xlsx + lint mensonger | Typage DTO complet, wb.xlsx.writeBuffer(), eslint flat config RÉEL (0 erreur, warn any) | typecheck 4 apps vert ; `npm run lint` s'exécute réellement | ✅ CORRIGÉ |
| Bonus | (découvert par la garde RLS) jauges /metrics à 0 sous NOBYPASSRLS + jauge sync_ops sur colonne inexistante | Migration 050 : metrics_global_counts() SECURITY DEFINER ; received_at | Garde RLS échoue sur l'ancien code (comptage tables tenant direct) ; /metrics servi via fonction | ✅ CORRIGÉ |

### Preuves d'exécution (2026-08-23, PostgreSQL 18.4 réel, rôle NOBYPASSRLS)

- `bash scripts/run-isolation-suites.sh` → **26/26 VERTES** (garde RLS +
  25 suites : schema-check, rls-behavior, isolation, phase3→phase22) —
  phase22 : 41 assertions. Runner : `scripts/run-isolation-suites.sh`.
- Mutation : `bash scripts/mutation-proof.sh` — chaque correctif réverté
  temporairement → tests ROUGES ciblés → restauré → VERT (6 mutations
  scriptées + M2b/M4/M5 rejouées sur tests durcis).
- Typecheck EXÉCUTÉ : api, worker, admin-web, support-console — 0 erreur.
- Builds EXÉCUTÉS : api+worker (tsc), admin-web + support-console (vite).
- `npm audit --omit=dev` → **0 vulnérabilité**.
- `node scripts/migrate.mjs --status` → 001→050 appliquées, checksums OK.
- `npm run test:unit` (jest) → 3/3 (succès persiste ; rowCount=0 → 500 ;
  échec passerelle → failed) — le P0 aurait été détecté ici.
- Garde anti-bypass RLS : 61 accès pool.query bruts revus, tous conformes
  (SECURITY DEFINER ou tables système justifiées, 1 exception inline
  documentée) ; la garde ÉCHOUE sur le code pré-correctif (détecte
  précisément `UPDATE payments` via pool brute).

### Méthode (complément au §méthode du prompt de continuation)

8. Garde anti-bypass RLS AVANT tout : `node scripts/check-rls-usage.mjs`
   (intégré au runner + CI). Tout pool.query brut sur table tenant est un
   ÉCHEC — seules exemptions : fonctions SECURITY DEFINER whitelistées,
   tables système justifiées, ou commentaire inline `rls-guard: allow
   <raison>` adossé à une policy couvrant réellement l'accès.
9. Toute nouvelle table à clé de stockage fichier reçoit le CHECK 049
   (pas de `..`, pas de chemin absolu, charset sûr) — cf. migration 049.
10. CI = postgres:18 (aligné sur le moteur validé, embedded-postgres
    18.4.0-beta.17) — jamais 16/17 (le bug jobs_finish 024→048 a montré
    ce qu'un moteur divergent masque).

---

## État du dépôt (août 2026)

| Élément | État |
|---|---|
| Branche de travail | branche de session Arena active (historiquement `arena/019fbeff-cr-chedz`, puis `arena/019fc32c-cr-chedz`) — ne jamais changer |
| Migrations | 001 → 052 (schéma complet, RLS robuste `app_tenant_id()`, facturation bornée, webhook + jobs SECURITY DEFINER, paie, otp channel, vidéo post-DPIA, fix jobs_finish, 049 CHECK storage_key + 050 métriques SECURITY DEFINER — audit, **051 expiry pending SATIM + invoice_id + payments_expire_pending()** — MISSION P1, **052 garde de montant dans billing_webhook_apply (CREATE OR REPLACE 024/039, refus explicite PAYMENT_AMOUNT_MISMATCH)** — MISSION P2) |
| Suites de tests | `tests/tenant-isolation/` : schema-check (renforcé FORCE/policy/ancrage), rls-behavior-check (GATE), isolation (S2), phase3 → phase21, **phase22 correctifs d'audit**, **phase23 expiration pending (MISSION P1)**, **phase24 webhook tardif (MISSION P2 : expiré/supersédé confirmé honnêtement + montant ≠ refusé explicitement, prouvé par mutation)** — **27/27 vertes + garde RLS auto-synchronisée au catalogue (28/28 runner) sur PostgreSQL 18 réel** ; + 12 tests unitaires jest (payment-provider 4 + garde config 8) |
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
# Base de test : PostgreSQL 18 embedded (run_pg.mjs à la racine)
#   node run_pg.mjs   (port 54329, base creche_test, initialise si purgé)

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
node tests/tenant-isolation/phase22-audit-fixes.api.test.mjs
node tests/tenant-isolation/phase23-pending-expiry.api.test.mjs
node tests/tenant-isolation/phase24-late-webhook.api.test.mjs

# OU tout l'ordre canonique d'un coup (inclut la garde RLS en tête) :
bash scripts/run-isolation-suites.sh

# Preuve par mutation MISSION P1 (worker réverté → ROUGE, supersede réverté →
# ROUGE, 051 retirée → ROUGE, restaurations → VERT) :
bash scripts/mutation-phase23-proof.sh

# Preuve par mutation MISSION P2 (052 retirée → ROUGE montant ignoré,
# mapping API réverté → ROUGE 500, restaurations → VERT) :
bash scripts/mutation-phase24-proof.sh

# Garde anti-bypass RLS seule / lint réel / tests unitaires
node scripts/check-rls-usage.mjs --verbose
npm run lint
npm run test:unit

# Typechecks
npm run typecheck --workspace @creche/api
npm run typecheck --workspace @creche/worker
npm run typecheck --workspace @creche/admin-web
npm run typecheck --workspace @creche/support-console

# Restaurer la CI
git add .github && git commit -m "ci: restore workflows" && git push
```

---

## Mise à jour 2026-09-24 — lot 2 du plan de réparation (lecture des contenus)

Le contrat de **lecture** des fichiers a changé (P0 « F5 », décision A) : l'API ne rend plus
d'URL signée S3/MinIO — inexploitable, MinIO étant lié à `127.0.0.1` en production. Photos,
photos parent, exports, PDF de facture et clips sont servis **same-origin** par l'API
(`/api/v1/…/content`) et le lien rendu est un **chemin relatif**. Les clients le consomment avec
le JWT (`apiOpenBlob` côté web, `ParentApiClient.photoContent` côté parent) : un `<img src>`/
`window.open` nu recevrait 401, le garde JWT n'acceptant que l'en-tête `Authorization`.
Détails, tableau avant/après et preuves : `docs/PLAN_REPARATION_2026-09-24.md` §4 (lot 2) ;
suite de preuve : `tests/tenant-isolation/phase66-content-same-origin.api.test.mjs`.

## Mise à jour 2026-09-24 — lot 2, volet B : l'upload média passe par l'API

Le contrat d'**écriture** des médias a changé lui aussi. `POST /api/v1/media/upload`
(`multipart/form-data`, champ `file`, rôles personnel) reçoit les octets, les vérifie puis c'est
le **serveur** qui écrit l'objet (`storage.put()`, backend local comme S3) — la clé est construite
côté serveur (`<org>/photo|document/<horodatage>-<nom assaini>`), jamais fournie par le client.
Enchaînement : `login → POST /media/upload (file + checksum) → GET /media/:id/download →
GET /api/v1/media/:id/content` (octets identiques ; `phase67` le prouve de bout en bout, jusqu'à
la lecture parent sous consentement).

- Refus **avant** écriture : `MEDIA_FILE_REQUIRED`, `MEDIA_MIME_NOT_ALLOWED` (liste blanche
  partagée avec le presign), `MEDIA_CHECKSUM_MISMATCH` (SHA-256 annoncé ≠ reçu),
  `MEDIA_CONTENT_MISMATCH` (signature binaire ≠ type annoncé) — tous 422 bilingues.
- Plafonds : produit **8 Mio** → 422 `MEDIA_TOO_LARGE` ; dur multer **12 Mio** → **413 JSON**
  (jamais une page HTML) ; `client_max_body_size 12M` dans `nginx.conf` (aligné).
- Production : `presignPut` **refuse** (503 `UPLOAD_VIA_API_REQUIRED`) sans `S3_PUBLIC_ENDPOINT`.
  C'est le garde qui remplace l'échec silencieux sur le téléphone par une erreur explicite. Il
  couvre aussi `POST /video/clips/presign-upload` (message adapté par appelant).
- Preuves : `tests/tenant-isolation/phase67-media-upload.api.test.mjs` (31 vérifications, ajoutée
  au runner → **71 entrées**) ; tests unitaires `apps/api/src/modules/media/storage.service.spec.ts`
  et `dto/media.dto.spec.ts` (15 cas, dont la normalisation multipart de `children_in_photo` —
  sans elle `all_consents_checked` resterait faux et la photo ne serait jamais publiée).

**Reste ouvert (dit tel quel, aucun cliquet baissé)**
1. `apps/staff-mobile/lib/core/media/media_uploader.dart` appelle **encore** le presign
   (`presign → putSigned → register`). À basculer sur `POST /media/upload` en multipart avec le
   même jeton. **Non livré** : aucun SDK Flutter ici → aucun `flutter test` ne pourrait le
   prouver ; à faire avec le lot 3 (même blocage que le lockfile `parent-mobile`).
2. **Photo hors ligne** (`add_photo`) : le client envoie `bytes` (base64) mais le serveur ne lit
   que `storage_key`/`mime_type` → asset créé, **aucun octet écrit**, lecture 404
   `MEDIA_CONTENT_MISSING` (preuve exécutée, plan §3.2). Correctif côté client (file locale →
   upload API) ; faire passer les octets dans `POST /sync/push` suppose de relever la limite de
   corps JSON de cette route — décision non prise.
3. **Clips vidéo** : presign *fail-closed* en production, mais téléversement **par l'API** non
   livré (fichiers volumineux : dimensionnement dédié).

## Mise à jour 2026-09-24 (soir) — CI : régression du lot 1 corrigée, verrou ajouté

**Contrat à respecter par toute nouvelle suite** : un processus `NODE_ENV=production`
ne doit JAMAIS hériter du raccourci de banc d'essai `RATE_LIMIT_DISABLED`
(le runner d'isolation l'exporte à `1`, le job CI `database` à `true`). Depuis le
lot 1, la garde de configuration refuse ce raccourci en production : une suite qui
lance `apps/api/dist/main.js` ou `apps/worker/dist/main.js` avec `...process.env`
voit le processus mourir au boot (« GARDE CONFIG PRODUCTION ») au lieu du motif
qu'elle teste. Utiliser `PRODUCTION_SPAWN_ENV` (`tests/tenant-isolation/helpers.mjs`) —
`phase26` refuse tout spawn de production non neutralisé (verrou, 5 fichiers
signalés sur `HEAD` avant correctif, 0 après). Suites corrigées : `phase22`,
`phase26`, `phase27`, `phase28`, `phase49`.

**État CI au 2026-09-24** — le job `database` est rouge, pour deux causes :
1. **H1 (préexistant, environnemental, non corrigé)** : le runner ne peut plus
   tirer `postgres:18-alpine` ni `quay.io/minio/minio` (`unauthorized`). Le gate
   se terminait la veille (`52e6ef3`) : rien de code n'a changé de ce côté.
2. **Régression du lot 1 (corrigée ici)** : `Gate D interrompu :: … phase26 …`
   → le gate s'arrêtait **avant la batterie**, qui n'a donc pas tourné en CI sur
   `f73c7c0`, `e3728cc`, `225fead`.

**Rejouer la CI en local** (le mode 1 ne suffit pas — il ne joue ni phase26 ni
les rôles de production) :
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
  RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local \
  STORAGE_LOCAL_DIR=/tmp/creche-storage-ci PAYMENT_WEBHOOK_SECRET=phase8-test-secret \
  ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```
Lire les échecs CI par les **annotations check-runs** (les logs par API/job
échouent en `EOF`) : voir `docs/CI-DATABASE-JOB-FINDINGS.md`, dernière section.

## Mise à jour 2026-09-24 — lot 5 : vérité documentaire verrouillée

L'audit du 2026-09-24 avait relevé quatre documents « flatteurs » (capacités absentes annoncées au
présent, compteurs périmés) alors que toutes les suites passaient au vert : le code était sain, la
documentation mentait, rien ne pouvait le signaler. C'est désormais l'inverse.

**Contrat** : `tests/tenant-isolation/claims-contract.test.mjs` (8 contrôles, **aucune base, aucun
Docker** → exécuté dans le job CI `quality`). Il recalcule la réalité et la confronte aux
documents :
- aucune occurrence de l'ordonnanceur externe dans le code/config, et chaque mention
  documentaire doit être une mise en garde (l'ordonnancement est en base : `scheduler_ticks`) ;
- healthcheck Docker : mesuré **fichier par fichier** (`postgres` partout, `api` + `worker` en
  production et staging depuis le lot 6.1, `postgres` seul en dev — le motif est écrit dans le
  fichier), **aucun** `HEALTHCHECK` dans les Dockerfiles (sans `curl` ni `wget`, l'image
  `node:22-slim` impose une sonde Node appelée par Compose) — et aucune phrase de documentation ne
  peut revendiquer plus, ni citer un décompte périmé (`grep -c healthcheck … # n`) ;
- compteurs recalculés à chaque exécution (migrations, entrées du runner, suites `phaseNN`,
  fichiers du dossier d'isolation, ADR, runbooks, routes HTTP via l'inventaire, chemins OpenAPI) ;
- phrases bannies (les affirmations fausses de l'audit + `presignGet(`) : interdites sauf corrigées
  sur la même ligne.

**Conséquence pour la suite** : ajouter une migration, une suite, une route ou un ADR **fait
échouer la CI** tant que les documents qui les revendiquent n'ont pas été mis à jour. C'est la
friction voulue — mettre à jour le **document**, jamais le contrat (sauf décision explicite).
Une volumétrie brute de fichiers doit porter sa **date** (« N fichiers au 2026-09-24 ») : elle
n'est pas verrouillée, une mesure datée n'est pas une propriété.

**Preuve par mutation** : 6 mutations exécutées (route périmée, phrase « healthcheck » non
qualifiée, phrase fausse canonique réintroduite, compteur de suites périmé, décompte de
healthchecks périmé, sonde renommée sur disque) → mutation : 6 rouges ; restaurations → 9/9 vert
(journal au plan §5).
Mesure du jour : 198 routes / 50 sans `@Roles`, 75 migrations, 71 entrées, 69 suites `phaseNN`,
85 fichiers d'isolation, 14 ADR, 32 runbooks.

---

## Mise à jour 2026-09-24 — lot 1.5 : « un gardien que rien n'appelle ne garde rien »

Le lot 1 avait câblé les 4 gardiens orphelins **cités** par l'audit. En recensant la classe entière
(et non les seuls cas nommés), un cinquième est apparu : `scripts/audit-seeds-pii.mjs` — la preuve que
les seeds SQL + pilote sont 100 % synthétiques (téléphones DZ, emails, NIN), écrite pour la CI mais
appelée par aucun workflow.

Désormais :
- l'**audit PII des seeds tourne en CI** (`node scripts/audit-seeds-pii.mjs --strict`, job `quality`) :
  la politique « aucune donnée réelle commitée » est un contrôle, pas une déclaration d'en-tête ;
- un **cliquet** empêche le retour de la classe : `scripts/check-guards-wired.mjs` calcule par
  fermeture transitive, depuis les workflows, quels scripts sont atteignables, et refuse tout gardien
  non câblé. Convention de nommage : `check-*`, `audit-*`, `verify-*`, `inventory-*` — mesuré :
  **12 gardiens recensés, 0 orphelin**. Il se contrôle lui-même (il est dans sa propre liste).
- Limite assumée et écrite dans le script : une procédure de runbook qui dit « lancez ce gardien »
  ne compte pas — un document n'exécute rien.

Preuve par mutation : étape CI du gardien PII retirée → rouge (« 1 gardien que rien n'appelle ») ;
nouveau gardien fictif sans appelant → rouge ; PII réelle injectée dans un seed → `--strict` rouge
(« domaine gmail.com non reconnu comme synthétique »). Restaurations : vertes.

---

## Mise à jour 2026-09-24 — lot 6.1 : sondes de vivacité API et worker (F2)

**Ce qui manquait** : `postgres` était le seul service sondé par Docker. L'API exposait bien
`GET /api/v1/health` (proxifié par nginx), mais **Docker ne l'interrogeait pas** ; le worker
n'exposant aucun port, il n'avait aucun marqueur de vie. Un processus vivant mais figé (pool
saturé, boucle bloquée) restait donc en service indéfiniment — la panne silencieuse par
excellence.

**Livré** :
- `apps/api/src/healthcheck.ts` → sonde qui interroge le **vrai** endpoint public
  (`http://127.0.0.1:$APP_PORT/api/v1/health`), sortie 0/1, timeout `HEALTHCHECK_TIMEOUT_MS`.
  Pourquoi un script Node : l'image d'exécution est `node:22-slim`, **sans `curl` ni `wget`**.
- `apps/worker/src/liveness.ts` → marqueur local (`WORKER_LIVENESS_FILE`, défaut
  `/tmp/creche-worker-alive`) réécrit toutes les 10 s (`WORKER_LIVENESS_INTERVAL_MS`), écriture
  **atomique** (`rename`), supprimé à l'arrêt propre ; `apps/worker/src/healthcheck.ts` refuse un
  marqueur absent ou plus vieux que 3 intervalles. Le heartbeat en base (`jobs_heartbeat`, 053)
  n'existe que **pendant un job** : un worker sain et au repos aurait paru mort — d'où un marqueur
  de processus.
- Compose : sondes `api` + `worker` en **production et staging** (`interval 30s`, `timeout 5s`,
  `retries 3`, `start_period` 30 s / 60 s). En **dev** : pas de sonde, motif écrit dans le fichier
  (sources montées + compilation à chaud, `dist/` non garanti au démarrage).
- Redémarrage : `restart: unless-stopped` existait déjà ; un conteneur `unhealthy` est redémarré
  par l'ordonnanceur/`docker` selon la politique d'exploitation, et le bail du job en cours est
  repris par `jobs_reap_stale` (053) — **aucun job perdu**.
- Le contrat de vérité documentaire (lot 5) a été **mis à jour, pas contourné** : la mesure attendue
  par fichier est explicite, et un nouveau verrou compare tout décompte cité dans la doc
  (`grep -c healthcheck … # n`) à la mesure du disque.

**Preuves exécutées (24/09)** :
1. `apps/worker` a désormais sa porte de tests (`apps/worker/jest.config.mts`, `npm run test:unit`
   à la racine couvre api **et** worker) : **5 tests** du marqueur (dont péremption, atomicité,
   câblage réel dans `main.ts`).
2. API : **6 tests** de la sonde (`apps/api/src/healthcheck.spec.ts`) lançant le script **compilé**
   contre un vrai serveur HTTP (200 `{"status":"ok"}` → 0 ; 500, corps inattendu, corps non-JSON,
   rien n'écoute, serveur muet → 1).
3. Bout en bout, hors Docker : API réelle `node apps/api/dist/main.js` sur :3399 →
   `node apps/api/dist/healthcheck.js` ⇒ **rc=0** (« API saine ») ; même sonde sur un port mort ⇒
   **rc=1**.
4. Worker réel `node apps/worker/dist/main.js` (rôle `creche_app_test`, boucle de jobs active) :
   marqueur écrit puis rafraîchi ⇒ sonde **rc=0** ; marqueur antidaté de 60 s ⇒ **rc=1**
   (« marqueur périmé de 60 s (maximum 6 s) ») ; après `SIGTERM` et arrêt propre ⇒ marqueur
   **supprimé** et sonde **rc=1** (« marqueur absent »).
5. `docker compose config` : les trois fichiers restent valides (analyse YAML) ; sondes confirmées
   sur `api` et `worker` en prod/staging.
