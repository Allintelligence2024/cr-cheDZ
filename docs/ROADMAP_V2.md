# ROADMAP v2 — après go-live (Phase 12)

> Fonctionnalités différées du MVP (backlog v2) + axes de durcissement issus
> du bilan pilote. Priorisation indicative : P0 (conforme/réparateur),
> P1 (demande forte), P2 (amélioration).

## Produit

| Priorité | Fonctionnalité | Notes |
|---|---|---|
| P1 | **Paiement en ligne CIB/Edahabia (SATIM)** | Feature flag `online_payment` prêt ; webhook signé idempotent déjà en place (billing_webhook_apply) ; intégration SATIM à connecter |
| P1 | **Messagerie parents ↔ crèche** | **✅ API faite et testée** (module messaging : conversations par enfant, participants auto (gardiens), garde participant + RLS, phase12-messaging 7 cas) ; écran web ⏳ |
| P2 | **WhatsApp Business API** | Flag `whatsapp_notifications` ; alternative au SMS pour l'OTP |
| P2 | **Planning du personnel** (roulements) | Flag `staff_planning` ; table staff_assignments extensible |
| P2 | **Multi-rôles par utilisateur** | Actuellement 1 rôle/org (ADR-001) ; table role_assignments à introduire |
| P2 | **Exports Excel** (présences, facturation) | Worker : stub `export_report` → implémenter (xlsx) |
| P2 | **PDF bilingue AR** | Composition arabe : embedding d'une police GSUB dans le générateur PDF |
| P3 | **Marketplace / annuaire public** | Flag `marketplace` ; site vitrine des crèches |
| P3 | **Application web mobile-responsive** | Admin-web desktop-first ; responsive complet |

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
| P2 | **Module paie** | Base salaires présente (staff_profiles) ; paie complète à développer |
| P2 | **Vidéosurveillance** | Hors périmètre sans DPIA préalable (loi 25-11) |
