# ROADMAP v2 — après go-live (Phase 12)

> Fonctionnalités différées du MVP (backlog v2) + axes de durcissement issus
> du bilan pilote. Priorisation indicative : P0 (conforme/réparateur),
> P1 (demande forte), P2 (amélioration).

## Produit

| Priorité | Fonctionnalité | Notes |
|---|---|---|
| P1 | **Paiement en ligne CIB/Edahabia (SATIM)** | **✅ Adaptateur implémenté et testé** (phase14, 8 cas : flag 422, non configuré 503, init HMAC + mock HTTP, webhook confirme le pending — migration 039) ; **production : config SATIM_* requise** |
| P1 | **Messagerie parents ↔ crèche** | **✅ API + écran web faits et testés** (module messaging, phase12-messaging 7 cas, MessagingPage) |
| P2 | **WhatsApp Business API** | **✅ FAIT** — canal whatsapp (file, flag scoped, gardien avec téléphone), worker notif_queue_claim/finish (042/043 — bug RLS du drain corrigé), jamais de faux sent (503 sans config), phase16 (6 cas) ; production : WHATSAPP_TOKEN/PHONE_ID requis |
| P2 | **Planning du personnel** (roulements) | Flag `staff_planning` ; table staff_assignments extensible |
| P2 | **Multi-rôles par utilisateur** | **✅ FAIT** — migration 040 (role_assignments, rétrocompatible : memberships = rôle principal), JWT roles[], RolesGuard multi, API assignation/retrait (directeur), ADR-001 évolué, phase15 (8 cas) |
| P2 | **Exports Excel** (présences, facturation) | **✅ FAIT** — worker export_report (exceljs), table report_exports (038), API /exports (phase13 8 cas) + **écran web ExportsPage** |
| P2 | **PDF bilingue AR** | **✅ FAIT** — pdfkit + Noto Naskh Arabic embarquée (GSUB), vérifié dans phase8 (police + ToUnicode) |
| P3 | **Marketplace / annuaire public** | Flag `marketplace` ; site vitrine des crèches |
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
| P2 | **Vidéosurveillance** | Hors périmètre sans DPIA préalable (loi 25-11) |
