# ROADMAP v2 — après go-live (Phase 12)

> Fonctionnalités différées du MVP (backlog v2) + axes de durcissement issus
> du bilan pilote. Priorisation indicative : P0 (conforme/réparateur),
> P1 (demande forte), P2 (amélioration).

## Produit

| Priorité | Fonctionnalité | Notes |
|---|---|---|
| P1 | **Paiement en ligne CIB/Edahabia (SATIM)** | **✅ Adaptateur implémenté et testé** (phase14, 8 cas : flag 422, non configuré 503, init HMAC + mock HTTP, webhook confirme le pending — migration 039) ; **production : config SATIM_* requise** |
| P1 | **Messagerie parents ↔ crèche** | **✅ API + écran web faits et testés** (module messaging, phase12-messaging 7 cas, MessagingPage) |
| P2 | **WhatsApp Business API** | **✅ FAIT** — canal whatsapp (file, flag scoped, gardien avec téléphone), worker notif_queue_claim/finish (042/043 — bug RLS du drain corrigé), jamais de faux sent (503 sans config), phase16 (6 cas) ; **+ OTP parent via WhatsApp (phase19, 7 cas : flag whatsapp_otp, otp_codes.channel migration 045, 422 sans flag / 503 sans config, roundtrip complet)** ; production : WHATSAPP_TOKEN/PHONE_ID requis |
| P2 | **Planning du personnel** (roulements) | Flag `staff_planning` ; table staff_assignments extensible |
| P2 | **Multi-rôles par utilisateur** | **✅ FAIT** — migration 040 (role_assignments, rétrocompatible : memberships = rôle principal), JWT roles[], RolesGuard multi, API assignation/retrait (directeur), ADR-001 évolué, phase15 (8 cas) |
| P2 | **Exports Excel** (présences, facturation) | **✅ FAIT** — worker export_report (exceljs), table report_exports (038), API /exports (phase13 8 cas) + **écran web ExportsPage** |
| P2 | **PDF bilingue AR** | **✅ FAIT** — pdfkit + Noto Naskh Arabic embarquée (GSUB), vérifié dans phase8 (police + ToUnicode) |
| P3 | **Marketplace / annuaire public** | **✅ FAIT** — endpoint public /marketplace (flag global, opt-in settings.public_listing, aucune donnée sensible), page vitrine admin-web (route /marketplace), phase18 (6 cas) ; publication par org via settings |
| P3 | **Application web mobile-responsive** | **✅ FAIT** — media queries 900/700px (sidebar → tiroir burger, tables scrollables, grilles 1 colonne) |

## Conformité & sécurité

| Priorité | Élément | Notes |
|---|---|---|
| P0 | **Migration NestJS 11 + express 5** | Solde les résidus npm audit (SECURITY.md) ; PR dédiée, suites complètes rejouées |
| P0 | **Workflows CI restaurés** | Permission `workflows` de la GitHub App requise ; puis e2e Playwright + CodeQL + Docker en CI |
| P1 | **Sentry** (backend + web + mobile) | DSN à provisionner |
| P1 | **Grafana + alertes** | Dashboard API/worker/DB ; alertes erreur rate > 1 %, jobs bloqués, disque |
| P1 | **Archivage rétention** (S3 glacier) | Complément de la purge (audit > 5 ans archivé, pas seulement supprimé) |
| P2 | **Backups chiffrés programmés** | Cron `scripts/backup.sh` + copie hors-site ; exercice de restauration mensuel |
| P2 | **Load tests k6 en CI** | `tests/load/sync.k6.js` prêt ; gate p95 < 2 s |

## Mobile

| Priorité | Élément | Notes |
|---|---|---|
| P1 | **Builds stores** (Play Console + App Store) | Nécessite SDK Flutter + comptes stores ; golden RTL AR à exécuter |
| P1 | **Device farm Android 2 Go RAM** | Profil release, mesure de la RAM, listes virtuelles |
| P2 | **Push FCM/APNs de bout en bout** | Secrets Firebase + APNs requis ; chemins d'échec déjà testés |

## Données

| Priorité | Élément | Notes |
|---|---|---|
| P1 | **Multi-établissements avancé** | Une organisation = plusieurs sites (déjà supporté) ; consolidation multi-org pour groupes |
| P2 | **Module paie** | **✅ FAIT** — migration 044, API generate/lignes/finalize (phase17 8 cas) + **écran web PayrollPage** (génération mensuelle, détail, lignes, finalisation) |
| P2 | **Vidéosurveillance** | **✅ DPIA + verrou + MODULE (phases 20-21)** — DPIA rédigée (docs/regulatory), flag exigeant DPIA approuvée par org (046), module V1 : caméras (zones limitées par la DPIA, CHECK base), clips DVR/NVR (presign S3 ou local), visionnage journalisé `read`, **purge 30 j par le worker** (stockage d'abord — jamais de fausse purge, échec S3 → job failed + réessai), écran VideoPage FR/AR ; phase21 (8 cas). PAS de live (hors périmètre documenté) ; **bug réel corrigé en route : jobs_finish enum cast (048 — chemin d'échec des jobs cassé depuis 024)** |
| P0-sécurité | **Correctifs d'audit externe — ✅ (phase22)** : défaut majeur paiement (UPDATE via pool brute → 0 ligne silencieuse RLS : corrigé, prouvé), durcissement stockage vidéo (préfixe tenant, anti-path-traversal, backend serveur seul, CHECK migration 049), gardes fichiers API+worker, garde anti-bypass RLS globale (le P0 serait mort né), migration 050 métriques SECURITY DEFINER |
