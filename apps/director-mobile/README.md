# Director Mobile — Application Direction Crèche DZ

Cockpit mobile pour directrices : dashboard temps réel, ratios, facturation, staff, journal.

> **Statut** : V1 MVP livré — 2026-09-29 — 10 écrans + cache offline + CI

## Stack
- Flutter 3.47.1
- Dio 5.x + flutter_secure_storage + shared_preferences + connectivity_plus
- Thème Sérénité (même que web / staff-mobile / parent-mobile)

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

## Fonctionnalités V1 (livrées)

- **Auth** : email/mdp + TOTP + refresh auto single-flight + époque G4 (retour login si révoquée)
- **Dashboard** : salles (présents/attendus/partis/absents), ratios `ok/warning/breach/empty` + headroom + 5 alertes (ratio_breaches, non pointés, docs expirants 30j, impayés, incidents 24h) + cache 5 min + offline banner + pull-to-refresh
- **Présences** : summary + ratios temps réel + filtre date + room cards
- **Couverture** : planifiés vs présents vs requis par salle + alertes gaps
- **Facturation** : liste impayées, aged-balance 0-30/31-60/61-90/90+, détail (lignes, totaux, balance) + actions send/mark-overdue/reminder + génération mensuelle (bottom sheet)
- **Enfants** : liste search + détail (FR/AR, allergies, tuteurs)
- **Staff** : profils + documents expirants + couverture du jour
- **Journal** : feed du jour + filtre type (meal, nap, diaper, activity, incident, note)
- **Paie** : liste runs par mois + détail + lignes (lecture seule V1)
- **Plus** :
  - Attestations (frais de garde, PDF via API)
  - Exports (Excel présences/facturation)
  - Sites & Salles (expansion tile)
  - Notifications inbox
  - Paramètres (profil, org, version, logout)

## Architecture

- `core/api_client.dart` : Dio + refresh single-flight + onSessionExpired (L3) + 20 endpoints
- `core/token_store.dart` : SecureStorage + InMemory pour tests
- `core/cache_service.dart` : SharedPreferences cache JSON 5 min TTL (dashboard, aged-balance)
- `core/connectivity_service.dart` : online/offline stream
- `core/error_state.dart` : distinction offline vs server + buildApiError
- `core/l10n.dart` : FR/AR minimal (V2 = vrai package i18n)
- `core/widgets/` : offline_banner, empty_state, stat_card
- `features/*` : écrans par domaine (10+)
- `theme/serenite_theme.dart` : copie exacte design-system (clair/sombre)

## Sécurité

- Tokens en secure storage, jamais loggés
- Pas de PII dans logs
- RLS côté API : rôle director/receptionist/super_admin requis
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
