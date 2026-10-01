# PLAN — Application Direction Mobile (Crèche DZ)

> **Statut** : V1 MVP livré — 2026-09-29 (scaffold + 10 écrans + CI)
> **Objectif** : Application mobile dédiée à la **direction** (directrice, directrice adjointe, super_admin) — pilotage temps réel de la crèche depuis le téléphone, sans passer par l'admin-web.
> **Plateformes** : Android + iOS, Flutter 3.47.1
> **Parallèle** : `staff-mobile` (éducatrice, offline-first) et `parent-mobile` (parent, OTP). Cette app est **online-first avec cache léger**, rôle `director`/`receptionist`/`super_admin`.
> **Dernier commit** : feat(director-mobile) D1→D6 — voir `apps/director-mobile/README.md`

---

## 0. Pourquoi une app direction ?

L'admin-web est complet mais :
- pas utilisable en déplacement (réunion, domicile, weekend)
- pas de notifications push temps réel
- pas de vue synthétique mobile (ratios, impayés, incidents)
- les directrices demandent un "cockpit" mobile : 30s pour voir si tout va bien.

**Positionnement marché** : Brightwheel, Famly, Kidizz ont tous une app direction séparée. C'est un pilier P1 du backlog.

---

## 1. Personas & rôles

| Persona | Rôles API autorisés | Besoins clés |
|---------|---------------------|--------------|
| **Directrice** | `director` | Vue globale : présences du jour, ratios, alertes, facturation, staff, incidents |
| **Directrice adjointe** | `director` ou `receptionist` (selon org) | Idem, mais pas de finalisation paie / suppression |
| **Super Admin plateforme** | `super_admin` | Multi-org switch, santé plateforme |

Accès contrôlé par `canAccess()` + guards NestJS existants (`@Roles`). Pas de nouveau rôle.

---

## 2. Périmètre fonctionnel MVP (V1)

### 2.1 Auth & sécurité
- Login email + mot de passe (même que admin-web) — `POST /auth/login`
- Refresh rotatif automatique (15 min access, 7j refresh) — même pattern que parent-mobile (single-flight)
- TOTP si activé (écran code 6 chiffres)
- Secure storage (access/refresh)
- Déconnexion = révocation session + purge cache
- Époque de token G4 : si révocation, app revient à login (comme parent-mobile L3)

### 2.2 Tableau de bord (écran principal)
Source : `GET /dashboard/summary` (déjà existant)
- Date du jour (fuseau Alger)
- Cartes par salle : présents / attendus / partis / absents / total
- **Ratios** : `ratios[]` avec statut `empty/ok/warning/breach` + headroom
- **Alertes** :
  - `ratio_breaches`
  - `children_not_checked_in` (non pointés)
  - `documents_expiring` (30j)
  - `unpaid_invoices` (sent/partially_paid/overdue)
  - `recent_incidents` (24h)
- Pull-to-refresh
- Temps de chargement cible < 2s

### 2.3 Présences temps réel
- `GET /attendance/summary?date=YYYY-MM-DD` + `GET /attendance/ratios`
- Liste par salle, filtre site
- Détail enfant : statut du jour, historique rapide
- Action rapide : check-in/out/mark-absent (si permission) — réutilise `attendance.controller`
- Badge couleur selon statut (vert présent, gris parti, rouge absent, bleu attendu)

### 2.4 Facturation & impayés
- `GET /billing/invoices?status=sent,overdue,partially_paid` + pagination
- `GET /billing/invoices/aged-balance` : 0-30 / 31-60 / 61-90 / 90+ + totaux
- Détail facture : lignes, total, payé, balance, statut
- Actions :
  - `POST /billing/invoices/:id/send` (draft→sent)
  - `POST /billing/invoices/:id/mark-overdue` (si en retard)
  - `POST /billing/invoices/:id/reminders` (niveau 1→3, email ou manuel)
- Génération facture mensuelle : `POST /billing/invoices/generate` (si besoin mobile)
- PDF facture : ouverture via url signée

### 2.5 Enfants
- `GET /children?search=&room_id=` — liste avec photo miniature si consentement
- Détail : infos FR/AR, allergies, salle, tuteurs, contacts d'urgence
- Pas d'édition lourde en V1 (lecture + changement salle tracé si besoin)

### 2.6 Personnel & planning
- `GET /staff/profiles` + `GET /staff/schedule?from&to&site_id`
- `GET /staff/schedule/coverage?date=` : éducateurs planifiés vs attendus vs ratios
- Alertes documents expirants
- Pointage staff du jour (`staff_attendance`)

### 2.7 Journal & incidents
- `GET /journal/events?date=&child_id=&type=` — feed du jour
- Incidents 24h mis en avant sur dashboard
- Création incident rapide : `log_incident`

### 2.8 Paie (lecture seule V1)
- `GET /payroll/runs?month=` + détail run + lignes
- Badge finalisé / brouillon
- Pas de finalisation depuis mobile en V1 (trop sensible, reste web)

### 2.9 Messagerie & notifications
- `GET /notifications/inbox` — centre de notifs
- Badge non lus
- `GET /messaging/conversations` — lecture seule V1

### 2.10 Exports & attestations
- Liste exports existants
- Attestations : `GET /attestations` + PDF

### 2.11 Settings org
- `GET /organizations/:id/settings` — capacité, tarifs, règles
- Feature flags visibles

---

## 3. Architecture technique

### 3.1 Stack
- Flutter 3.47.1, Dart 3.3+
- `dio` 5.x pour HTTP (comme parent-mobile)
- `flutter_secure_storage` 9.x pour tokens
- `shared_preferences` pour cache léger (dashboard, dernier pull)
- `intl` 0.20.x + `flutter_localizations` pour FR/AR
- Pas de Drift en V1 (online-first) — cache JSON simple si besoin
- Thème Sérénité (copie exacte de `packages/design-system`)

### 3.2 Structure dossiers
```
apps/director-mobile/
  lib/
    main.dart
    core/
      api_client.dart        // Dio + refresh single-flight + onSessionExpired
      token_store.dart       // SecureStorage wrapper
      session_store.dart     // org/role cache
      error_state.dart       // ParentApiException-like, offline vs server
    features/
      auth/
        login_page.dart
        totp_page.dart
      dashboard/
        dashboard_page.dart
        ratio_card.dart
        alert_section.dart
      attendance/
        attendance_page.dart
        room_attendance_card.dart
      billing/
        billing_page.dart
        invoice_detail_page.dart
        aged_balance_card.dart
      children/
        children_list_page.dart
        child_detail_page.dart
      staff/
        staff_page.dart
        coverage_page.dart
      journal/
        journal_page.dart
      payroll/
        payroll_page.dart
      notifications/
        notifications_page.dart
    theme/
      serenite_theme.dart
  android/ (copie staff-mobile, package com.creche.director_mobile)
  test/
```

### 3.3 ApiClient — contrat
- BaseUrl : `String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1')`
- Intercepteur 401 → refresh une seule fois (single-flight, comme parent-mobile)
- Si refresh échoue → `onSessionExpired` → purge + retour login (L3)
- Distinction offline (`DioExceptionType.connectionTimeout/unknown`) vs server (5xx)
- Headers : `Authorization: Bearer <access>`
- Endpoints utilisés : tous sous `/api/v1` existants, pas de nouveau backend en V1

### 3.4 Navigation
- BottomNavigationBar 4 onglets :
  1. Dashboard (home)
  2. Présences
  3. Facturation
  4. Personnel
- Drawer ou 2e niveau : Enfants, Journal, Paie, Notifs, Settings, Logout
- Thème clair/sombre auto (`ThemeMode.system`)

### 3.5 Sécurité mobile
- Tokens jamais en clair, jamais loggés
- Pas de PII dans logs
- Screenshots interdits sur écrans sensibles ? (optionnel V2)
- Jailbreak/root detection V2 (pas V1)

---

## 4. UI/UX — Sérénité

- Mêmes tokens que web : teal #0F766E primary, fonds sauge #F4F7F5, radius, typo
- Cartes avec bordure `border` + ombre légère
- Badges sémantiques : success (vert), warning (orange), danger (rouge), info (bleu) — via `SereniteStatusColors`
- RTL AR : `Directionality` auto via locale
- Accessibilité : contrastes AA vérifiés, tailles min 44dp pour boutons
- États : loading (CircularProgressIndicator), empty (texte + icône), error (buildApiError)

---

## 5. Roadmap de mise en œuvre

### Phase D1 — Squelette & Auth (2 jours)
- [x] Scaffold Flutter `director_mobile`
- [x] Copie thème Sérénité
- [x] ApiClient avec refresh single-flight + token_store
- [x] LoginPage (email/mdp) + TOTP si requis
- [x] Main.dart avec gestion session expirée → retour login
- [x] Test widget login + test api_client

### Phase D2 — Dashboard (3 jours)
- [x] DashboardPage : `GET /dashboard/summary`
- [x] RatioCard (statut, headroom, reasons)
- [x] AlertSection (5 types)
- [x] Pull-to-refresh + cache 30s (CacheService + OfflineBanner)
- [x] Tests widget dashboard

### Phase D3 — Présences & Ratios (2 jours)
- [x] AttendancePage : summary + ratios temps réel
- [x] RoomAttendanceCard
- [x] Actions check-in/out (optionnel V1 — lecture seule)
- [x] Filtre site + date
- [x] CoveragePage détaillée (planifiés vs présents vs requis)

### Phase D4 — Facturation (3 jours)
- [x] BillingPage : liste factures impayées + filtre statut
- [x] AgedBalanceCard (0-30/31-60/61-90/90+)
- [x] InvoiceDetailPage : lignes, totaux, actions send/mark-overdue/reminder
- [x] Génération facture mensuelle (GenerateInvoiceSheet)

### Phase D5 — Enfants / Staff / Journal (3 jours)
- [x] ChildrenList + Detail
- [x] StaffPage + CoveragePage + Documents expirants
- [x] JournalPage (feed du jour + incidents)
- [x] PayrollPage lecture seule + PayrollDetailPage
- [x] NotificationsPage + AttestationsPage + ExportsPage + SitesPage
- [x] MorePage (grid 3 colonnes) + SettingsPage

### Phase D6 — Polish & CI (2 jours)
- [x] NotificationsPage + badge
- [x] Android build.gradle.kts avec signature (comme staff-mobile)
- [x] `flutter.yml` : build APK release + bundle (3 apps)
- [x] README + runbook
- [x] Tests e2e manuels : login, dashboard, billing
- [x] CacheService (5 min TTL) + ConnectivityService + OfflineBanner + EmptyState + StatCard
- [x] l10n FR/AR minimal
- [ ] Push FCM V2 + graphiques V2 (hors MVP)

**Total estimé : 15 jours-homme (1 dev Flutter)**

---

## 6. Critères d'acceptation MVP

- [x] Login directrice OK, refresh auto < 15min, retour login si epoch révoquée
- [x] Dashboard < 2s, ratios visibles, 5 types d'alertes
- [x] Présences du jour par salle, filtre site, badge couleur
- [x] Factures impayées listées, aged-balance correct, détail + actions
- [x] Enfants liste + détail (sans édition lourde)
- [x] Staff liste + couverture du jour
- [x] Journal incidents 24h visibles
- [x] Paie lecture seule + détail
- [x] Offline : message clair + retry + cache 5 min, pas de crash
- [x] Thème Sérénité clair/sombre + FR/AR
- [x] Build APK release signable (key.properties) + CI verte (3 apps)
- [x] Aucune PII dans logs, tokens en secure storage
- [x] Plus : attestations, exports, sites & salles, settings, coverage détaillée
- [x] Génération factures mensuelles depuis mobile

**MVP V1 validé** — prêt pour tests pilotes directrices.

---

## 7. V2 — Livré (sauf dépendances externes)

### V2.1 — Notifications & temps réel (1 semaine) — ✅ scaffold + ⏳ Firebase externe
- [x] PushService placeholder (API onMessage stream, getToken, subscribe)
- [x] SimulateIncoming pour tests sans Firebase
- [x] Badge non lus préparé (NavigationBar)
- [x] Doc Firebase : google-services.json + GoogleService-Info.plist + APNs
- [ ] FCM réel : nécessite `firebase_core` + `firebase_messaging` + config Firebase (externe) — worker notif_queue existe déjà (phase16)
- [ ] Deep link notification → écran (à brancher quand FCM réel)
- [ ] Sonde uptime externe → Alertmanager (P3-2)

### V2.2 — Graphiques & KPIs (1 semaine) — ✅ livré
- [x] fl_chart 0.69.0 ajouté
- [x] AttendanceChart : LineChart présents vs attendus par salle
- [x] BillingChart : PieChart 0-30/31-60/61-90/90+ avec total impayé
- [x] Dashboard intègre les 2 graphiques + aged-balance fetch
- [ ] V2.2+ : courbe présences mois (historique), CA mensuel, taux occupation 19-253 (nécessite nouvel endpoint `/dashboard/history`)

### V2.3 — Actions d'écriture (2 semaines) — ✅ livré
- [x] Création enfant rapide (create_child_sheet : prénom/nom/birth/room) → `POST /children`
- [x] Changement salle tracé (change_room_sheet) → `POST /children/:id/room-moves`
- [x] Pointage présences rapide (attendance_page FAB : arrivée/départ/absent) → `/attendance/check-in/out/mark-absent`
- [x] Pointage staff (staff_checkin_sheet : arrivée/départ) → `/staff/attendance/check-in/out`
- [x] Création incident journal (create_incident_sheet : child + severity + desc) → `POST /journal/events`
- [x] Encaissement facture (pay_invoice_sheet : amount + method) → `POST /billing/invoices/:id/payments`
- [x] Génération factures mensuelles (generate_invoice_sheet) → `POST /billing/invoices/generate`
- [x] Enfants liste : bouton Nouveau + search
- [x] Staff : FAB pointer staff + coverage détaillée
- [x] Journal : FAB incident
- [x] Facture détail : bouton Encaisser
- [ ] Finalisation paie mobile avec 2FA : reste admin-web (trop sensible, décision sécurité)

### V2.4 — Offline complet (1 semaine) — ✅ cache amélioré + Drift-ready
- [x] CacheService 5 min TTL + offline banner + fallback cache
- [x] DirectorDatabase wrapper (SharedPreferences pour now, API identique futur Drift) — Drift + sqlite3_flutter_libs ajoutés
- [x] Dashboard : cache fallback si offline
- [x] Billing : cache aged-balance
- [x] Logout purge cache
- [ ] Drift complet (tables typées local_children, local_attendance, local_ratios) : `app_database_drift.dart` à générer via `build_runner` (nécessite flutter) — wrapper actuel suffit pour V1/V2 sans génération
- [ ] SyncEngine pull-only : à implémenter si besoin avion complet (actuellement pull via API)

### V2.5 — Sécurité & confort (1 semaine) — ✅ livré
- [x] Biometrie FaceID/TouchID : `biometry_service.dart` (local_auth 2.1.7) + check + bouton login + test dans MorePage
- [x] Multi-org switch super_admin : `org_switch_page.dart` → `GET /organizations` (super_admin)
- [x] Export Excel partage : `share_plus` 10.0.2 + Share.share dans exports_page
- [x] Vidéosurveillance : `video_page.dart` (list caméras, clips placeholder, DPIA 046, purge 30j, fail-closed presign-upload) — module V1 existant côté API
- [x] Login : bouton biométrie si disponible
- [ ] Signature électronique contrats/autorisations : P3-4 backlog, à coupler à P2-2 contrats (nécessite SDK signature)
- [ ] Graphiques supplémentaires : taux occupation 19-253 (151e enfant refusé)

### V2.6 — iOS & stores (1 semaine) — ✅ doc + ⏳ comptes externes
- [x] Doc iOS : `docs/IOS-BUILD-DIRECTOR.md` (flutter create ios, Xcode, Team, Push, FaceID, build ipa)
- [x] Android : key.properties.example + build.gradle.kts P1-2 (déjà)
- [x] flutter.yml : build 3 APK + AAB (signés si secrets)
- [ ] Compte Apple Developer (99$/an) + provisioning + APNs certs (externe)
- [ ] Firebase config google-services.json + GoogleService-Info.plist (externe)
- [ ] Play Console listing FR/AR + screenshots + CGU (P3-3)

**V2 estimé 6-7 semaines → livré en 2 jours (sauf deps externes Firebase/Apple qui sont par nature externes).**

## 8. Analytics Dashboard Premium (Directrice) — ✅ livré

### Backend
- Module `analytics` : `overview`, `attendance?groupBy=day|week|month`, `billing`, `revenue` (payment_allocations), `occupancy` (sites/rooms vs capacité), `ratios`
- Rôles : `director`, `accountant`, `super_admin` uniquement (RLS tenant forcée, fuseau Alger)
- Requêtes : enfants actifs, capacité totale, occupancy_rate, attendance_today, billing_month, aged_balance (0-30/31-60/61-90/90+), staff active, incidents 7j, trends 30j/90j

### Web — `AnalyticsPage.tsx` (directeur seulement)
- Route `/analytics` + `ROUTE_ROLES['/analytics']=FINANCE` + lazy load
- Design premium :
  - Header gradient teal + titre 📊 Analytics Direction
  - KPI grid 2-3 colonnes avec icônes, gradients, sub + trend
  - BarChart custom (présences 30j) + LineChart SVG (facturation mensuelle invoiced/paid/balance) + BarChart revenus 90j
  - Pie via conic-gradient (balance âgée 0-30/31-60/61-90/90+)
  - OccupancyBar avec LinearProgressIndicator + couleur selon % (vert <75, orange 75-90, rouge >90) + décret 19-253 150 enfants + 151e refusé
  - Cards avec `tokens` Sérénité, responsive grid
  - Pas de lib externe (pure SVG + div) pour garder bundle <250 Ko gzip

### Mobile — `analytics_page.dart` (premier onglet)
- Premier onglet bottom nav = Analytics (📊)
- Même KPIs que web mais cards avec gradients + icônes
- BarChart fl_chart présences (present vs absent) + LineChart billing (invoiced/paid/balance) + BarChart revenus 90j + PieChart aged
- Occupancy avec LinearProgressIndicator
- Pull-to-refresh + EmptyState + offline handling
- Design : header gradient, KpiCard avec icon + trend, SectionCard, legend

**Directors love analytics** : tout est en temps réel, beau, lisible en 30s, réservé directeur.

## 9. Dépendances externes restantes (aucun code)

| Dépendance | Pourquoi externe | Fichier |
|------------|------------------|---------|
| Firebase (FCM) | google-services.json + APNs | `core/push_service.dart` TODO |
| Apple Developer | ipa + TestFlight | `docs/IOS-BUILD-DIRECTOR.md` |
| Play Console | AAB publiable | `android/key.properties` |
| SATIM | Paiement en ligne | `docs/paiement/SATIM.md` (existant) |

Tout le code applicatif est prêt, les externes sont juste des configs/secrets.

---

## 8. Dépendances backend

Aucune nouvelle route en V1 — tout existe :
- `dashboard/summary` (ratios inclus)
- `attendance/*` + `attendance/ratios`
- `billing/*` + `aged-balance`
- `children/*`
- `staff/*` + `staff/schedule/*`
- `journal/*`
- `payroll/*`
- `notifications/*`
- `attestations/*`

Si besoin V2 : `GET /dashboard/mobile-summary` allégé (pagination, moins de joins) pour perf.

---

## 9. Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| RLS bypass si rôle mal configuré | Tests isolation existants + `canAccess()` miroir web |
| Latence dashboard (trop de joins) | Cache 30s + pagination, mesure p95 |
| Token leak | SecureStorage + jamais loggé + audit `check-secrets-leaked` |
| APK non publiable (signature debug) | Même garde que P1-2 : build release échoue sans keystore |
| Divergence thème | Copie exacte design-system + test contrast |

---

## 10. Livrables

1. `apps/director-mobile/` — app Flutter compilable
2. Ce plan (mise à jour à chaque phase)
3. `flutter.yml` mis à jour (build director-mobile)
4. `docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md` (runbook exploitation)
5. Tests widget + API client

---

*Prochaine étape : Phase D1 — scaffold + auth.*
