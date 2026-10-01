# Director Mobile — Application Direction Crèche DZ

Cockpit mobile premium pour directrices — analytics que les directrices adorent.

> **Statut** : V1 MVP + V2 complet — 2026-09-30 — Analytics premium + 12 écrans + graphiques + écritures + biométrie + CI
> **Web** : `apps/admin-web/src/pages/AnalyticsPage.tsx` — même analytics, réservé director/accountant/super_admin

## Stack
- Flutter 3.47.1
- Dio 5.x + flutter_secure_storage + shared_preferences + connectivity_plus + fl_chart 0.69.0 + local_auth 2.1.7 + share_plus 10.0.2 + drift 2.20.0
- Thème Sérénité (même que web / staff-mobile / parent-mobile)
- Backend : `apps/api/src/modules/analytics/` (overview, attendance, billing, revenue, occupancy, ratios) — RLS tenant forcée

## Démarrage

```bash
cd apps/director-mobile
flutter pub get
flutter run --dart-define API_URL=https://api.creche.dz/api/v1
# Emulateur Android :
flutter run --dart-define API_URL=http://10.0.2.2:3000/api/v1
```

## Build release (Android)

```bash
keytool -genkey -v -keystore android/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
# android/key.properties (jamais commité)
flutter build apk --release
flutter build appbundle --release
```

CI : `flutter.yml` compile 3 apps. Sans secrets → debug-signed via `ALLOW_DEBUG_SIGNING=true`.

## Fonctionnalités V1+V2 — Analytics Premium

### 📊 Analytics (premier onglet mobile + /analytics web) — directeur adore, design premium

**Backend** (`/analytics/*`, rôles director/accountant/super_admin) :
- `overview` : enfants actifs, capacité totale, occupancy_rate 19-253, attendance_today (present/expected/departed/absent), billing_month (invoiced/paid/balance/count/overdue/sent/partially_paid/paid_count), aged_balance (0-30/31-60/61-90/90+/total), staff active/total, incidents 7j critical
- `attendance?groupBy=day|week|month&from&to&site_id` : tendance 30j
- `billing?from&to` : facturation mensuelle invoiced/paid/balance
- `revenue?from&to` : revenus 90j via payment_allocations (fallback invoices)
- `occupancy` : sites + rooms vs capacité (enrolled/capacity)
- `ratios?date` : ratios jour + breaches 30j

**Mobile UI** (`analytics_page.dart`, premier onglet) :
- Header gradient teal + 📊 Analytics Direction + date + refresh
- KPI grid 2 colonnes : 6 cards avec icônes (👶📍💰⚠️👥🚨), gradients, sub, trend, couleurs sémantiques
- BarChart fl_chart présences (present vs absent) 30j + LineChart billing (invoiced/paid/balance) + BarChart revenus 90j + PieChart balance âgée
- Occupancy : sites + rooms (5) avec LinearProgressIndicator couleur selon % (vert <75, orange 75-90, rouge >90) + décret 19-253 150 enfants + 151e refusé auto
- Pull-to-refresh + EmptyState + offline handling + legend

**Web UI** (`AnalyticsPage.tsx`, /analytics, FINANCE roles) :
- Même KPIs + BarChart custom div + LineChart SVG polyline + Pie conic-gradient + OccupancyBar progress
- Design Sérénité premium : gradients, cards, responsive grid, tokens, icônes
- Pas de lib externe pour garder bundle <250 Ko gzip

**Accès** : réservé director/accountant/super_admin (RLS + @Roles) — éducatrices voient dashboard opérationnel, pas financier.

### Autres écrans (12+)

- **Auth** : email/mdp + TOTP + refresh single-flight + époque G4 + biométrie FaceID/TouchID + test
- **Dashboard** : salles + ratios ok/warning/breach + headroom + 5 alertes + AttendanceChart Line + BillingChart Pie + cache 5min + offline banner
- **Présences** : summary + ratios + filtre date + FAB pointer rapide (arrivée/départ/absent)
- **Couverture** : planifiés vs présents vs requis + gaps
- **Facturation** : impayées + aged-balance + PieChart + détail + actions send/mark-overdue/reminder/pay/generate
- **Enfants** : search + Nouveau + détail + change room + incident
- **Staff** : profils + docs expirants + couverture + FAB pointer staff
- **Journal** : feed + filtre type + FAB incident
- **Paie** : liste + détail + lignes (lecture seule V1)
- **Plus** : 12 sous-écrans (Personnel, Couverture, Journal, Paie, Notifs, Attestations, Exports avec share_plus, Sites, Vidéo DPIA, Organisations super_admin, Paramètres, biométrie) + Card biométrie

## Architecture

- `core/api_client.dart` : Dio + refresh single-flight + onSessionExpired + 30+ endpoints (analytics + V2 écritures)
- `core/token_store.dart` + `cache_service.dart` + `connectivity_service.dart` + `biometry_service.dart` + `push_service.dart` (FCM placeholder) + `database/app_database.dart` (Drift-ready)
- `core/widgets/` : offline_banner, empty_state, stat_card
- `core/l10n.dart` : FR/AR
- `features/analytics/` : analytics_page.dart premium + widgets attendance_chart, billing_chart
- `features/*` : 12 domaines + sheets (create_child, change_room, create_incident, pay_invoice, generate_invoice, staff_checkin)
- `theme/serenite_theme.dart` : Sérénité clair/sombre

## Sécurité

- Tokens secure storage, jamais loggés, pas PII logs
- RLS tenant forcée, époque G4, @Roles FINANCE pour /analytics
- Cache jamais PII sensible, TTL 5min, purge logout
- keystore jamais commité

## Tests

```bash
flutter test
```
- api_client_test : token store, error mapping, 30+ endpoints (analytics + écritures)
- widget_test : LoginPage, Dashboard, Billing, Attendance, Staff, MorePage grid, AnalyticsPage loading

## CI

`flutter.yml` : pub get --enforce-lockfile + analyze + test + build apk release 3 apps + aab si signés + vérif APK

## Prochaines étapes V2 restant (externes)

- FCM réel : firebase_core + firebase_messaging + google-services.json + APNs (voir HANDOFF M1)
- iOS : flutter create ios + Xcode Team + FaceID + Push + build ipa TestFlight (M5, docs/IOS-BUILD-DIRECTOR.md)
- Device farm 2Go RAM perf (M6), Sentry (M7), screenshots FR/AR + store listing (M8), pilotes 5 crèches (M9)

Voir `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` §7-9 + `docs/HANDOFF-DIRECTOR-MOBILE-ANTIGRAVITY.md` M1-M9.
