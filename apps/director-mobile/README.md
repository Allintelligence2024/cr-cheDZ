# Director Mobile — Application Direction Crèche DZ

Cockpit mobile pour directrices : dashboard temps réel, ratios, facturation, staff, journal + analytics premium.

> **Statut** : V1 MVP livré (2026-09-29) + V2 (analytics, écritures, biométrie, M1 FCM, M7 Sentry, remédiation sécurité) — 12 écrans + cache offline + CI
> **Web** : `apps/admin-web/src/pages/AnalyticsPage.tsx` — même analytics, réservé director/accountant/super_admin

## Stack
- Flutter 3.47.1
- Dio 5.x + flutter_secure_storage + shared_preferences + connectivity_plus + fl_chart 0.69.0 + local_auth 2.1.7 + share_plus 10.0.2
- firebase_core + firebase_messaging (M1 FCM, config externe non commitée) + sentry_flutter (M7, DSN optionnel)
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
# Générer keystore (une fois) :
keytool -genkey -v -keystore android/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload

# Créer android/key.properties (jamais commité) :
# storeFile=/chemin/vers/upload-keystore.jks
# storePassword=xxx
# keyAlias=upload
# keyPassword=xxx

flutter build apk --release
flutter build appbundle --release
```

CI : `flutter.yml` compile les 3 apps (staff, parent, director). Sans secrets keystore, build autorisé en debug-signed via `ALLOW_DEBUG_SIGNING=true`.

## Fonctionnalités

### 📊 Analytics (onglet mobile + /analytics web) — design premium

**Backend** (`/analytics/*`, rôles director/accountant/super_admin) :
- `overview` : enfants actifs, capacité totale, occupancy_rate 19-253, attendance_today (present/expected/departed/absent), billing_month (invoiced/paid/balance/count/overdue/sent/partially_paid/paid_count), aged_balance (0-30/31-60/61-90/90+/total), staff active/total, incidents 7j critical
- `attendance?groupBy=day|week|month&from&to&site_id` : tendance 30j
- `billing?from&to` : facturation mensuelle invoiced/paid/balance
- `revenue?from&to` : revenus 90j via payment_allocations (fallback invoices)
- `occupancy` : sites + rooms vs capacité (enrolled/capacity)
- `ratios?date` : ratios jour + breaches 30j

**Mobile UI** (`analytics_page.dart`) :
- Header gradient teal + 📊 Analytics Direction + date + refresh
- KPI grid 2 colonnes : 6 cards avec icônes (👶📍💰⚠️👥🚨), gradients, sub, trend, couleurs sémantiques
- BarChart fl_chart présences (present vs absent) 30j + LineChart billing (invoiced/paid/balance) + BarChart revenus 90j + PieChart balance âgée
- Occupancy : sites + rooms avec LinearProgressIndicator couleur selon % (vert <75, orange 75-90, rouge >90) + décret 19-253 150 enfants + 151e refusé auto
- Pull-to-refresh + EmptyState + offline handling + legend

**Web UI** (`AnalyticsPage.tsx`, /analytics, FINANCE roles) :
- Même KPIs + BarChart custom div + LineChart SVG polyline + Pie conic-gradient + OccupancyBar progress
- Design Sérénité premium : gradients, cards, responsive grid, tokens, icônes
- Pas de lib externe pour garder bundle <250 Ko gzip

**Accès** : réservé director/accountant/super_admin (RLS + @Roles) — éducatrices voient dashboard opérationnel, pas financier.

### Autres écrans (12+)

- **Auth** : email/mdp + TOTP + refresh auto single-flight + époque G4 (retour login si révoquée) + biométrie FaceID/TouchID
- **Dashboard** : salles (présents/attendus/partis/absents), ratios `ok/warning/breach/empty` + headroom + 5 alertes (ratio_breaches, non pointés, docs expirants 30j, impayés, incidents 24h) + AttendanceChart Line + BillingChart Pie + cache 5 min + offline banner + pull-to-refresh
- **Présences** : summary + ratios temps réel + filtre date + room cards + FAB pointer rapide (arrivée/départ/absent)
- **Couverture** : planifiés vs présents vs requis par salle + alertes gaps
- **Facturation** : liste impayées, aged-balance 0-30/31-60/61-90/90+ (PieChart), détail (lignes, totaux, balance) + actions send/reminder/pay/generate (la transition overdue est automatique côté serveur)
- **Enfants** : liste search + Nouveau + détail (FR/AR, allergies, tuteurs) + change room + incident
- **Staff** : profils + documents expirants + couverture du jour + FAB pointer staff
- **Journal** : feed du jour + filtre type (meal, nap, diaper, activity, incident, note) + FAB incident
- **Paie** : liste runs par mois + détail + lignes (lecture seule V1)
- **Plus** : 12 sous-écrans (Personnel, Couverture, Journal, Paie, Notifs, Attestations, Exports Excel via share_plus, Sites & Salles, Vidéo DPIA, Organisations super_admin, Paramètres, biométrie)

## Architecture

- `core/api_client.dart` : Dio + refresh single-flight + onSessionExpired (L3) + endpoints (analytics + V2 écritures)
- `core/token_store.dart` : SecureStorage + InMemory pour tests
- `core/cache_service.dart` : SharedPreferences cache JSON 5 min TTL (dashboard, aged-balance)
- `core/connectivity_service.dart` : online/offline stream
- `core/error_state.dart` : distinction offline vs server + buildApiError
- `core/observability.dart` : Sentry (M7, DSN optionnel) + époque G4
- `core/push_service.dart` : FCM (M1, mode dégradé sans config Firebase)
- `core/biometry_service.dart` : local_auth
- `core/l10n.dart` : FR/AR minimal
- `core/widgets/` : offline_banner, empty_state, stat_card
- `features/analytics/` : analytics_page.dart premium + widgets attendance_chart, billing_chart
- `features/*` : 12 domaines + sheets (create_child, change_room, create_incident, pay_invoice, generate_invoice, staff_checkin)
- `theme/serenite_theme.dart` : copie exacte design-system (clair/sombre)

## Sécurité

- Tokens en secure storage, jamais loggés
- Pas de PII dans logs
- RLS côté API : rôle director/receptionist/super_admin requis ; @Roles FINANCE pour /analytics
- Époque G4 : `users.token_epoch` bump → JWT invalide → app revient login
- Audit `check-secrets-leaked` : keystore jamais commité
- Cache : jamais de PII sensible, TTL 5 min, purge à logout

## Tests

```bash
flutter test
```

- `api_client_test.dart` : token store, error mapping, endpoints list
- `widget_test.dart` : LoginPage, DashboardPage loading, BillingPage loading

## CI

Job `flutter-check` dans `.github/workflows/flutter.yml` :
- pub get --enforce-lockfile
- flutter analyze (3 apps)
- flutter test (3 apps)
- flutter build apk --release (3 apps) + aab si signés
- Vérif APK présents + upload artefacts

## Prochaines étapes V2

Voir `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` §7 :

- **V2.1** : FCM push (arrivée, ratio breach, impayé, incident) + badge + deep link
- **V2.2** : Graphiques fl_chart (présences mois, CA, taux occupation, recouvrement)
- **V2.3** : Actions écriture (création enfant, changement salle, pointage staff, incident, finalisation paie avec 2FA)
- **V2.4** : Offline complet Drift (comme staff-mobile) + SyncEngine pull-only
- **V2.5** : Biométrie, multi-org super_admin, signature électronique, export Excel, vidéo (DPIA)
- **V2.6** : iOS TestFlight + Play Store listings FR/AR

Estimation V2 : 6-7 semaines (1 dev).

## Plan

Voir `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` pour roadmap détaillée D1→D6 (toutes cochées) + V2.
- api_client_test : token store, error mapping, endpoints (analytics + écritures)
- widget_test : LoginPage, Dashboard, Billing, Attendance, Staff, MorePage grid, AnalyticsPage loading

## CI

Job `flutter-check` dans `.github/workflows/flutter.yml` :
- pub get --enforce-lockfile
- flutter analyze (3 apps)
- flutter test (3 apps)
- flutter build apk --release (3 apps) + aab si signés
- Vérif APK présents + upload artefacts

## Prochaines étapes (dépendances externes)

- FCM réel : config firebase_core + firebase_messaging + google-services.json + APNs (code M1 livré, voir HANDOFF M1)
- iOS : flutter create ios + Xcode Team + FaceID + Push + build ipa TestFlight (M5, docs/IOS-BUILD-DIRECTOR.md)
- Device farm 2Go RAM perf (M6), Sentry (M7), screenshots FR/AR + store listing (M8), pilotes 5 crèches (M9)

Voir `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` §7-9 + `docs/HANDOFF-DIRECTOR-MOBILE-ANTIGRAVITY.md` M1-M9.
