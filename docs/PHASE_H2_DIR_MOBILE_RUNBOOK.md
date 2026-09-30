# Runbook — Application Direction Mobile (Phase D)

> Version 2026-09-29 — V1 MVP livré (10 écrans + cache + CI)
> App : `apps/director-mobile` — cockpit directrice
> Plan : `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md`

## 1. Prérequis

- Flutter 3.47.1 (cf. `flutter.yml` — version épinglée)
- JDK 17 (pour build Android)
- API en ligne : `https://api.creche.dz/api/v1` par défaut, ou local via `--dart-define API_URL=http://10.0.2.2:3000/api/v1` (émulateur)

## 2. Développement local

```bash
cd apps/director-mobile
flutter pub get
flutter run --dart-define API_URL=http://10.0.2.2:3000/api/v1
# ou
flutter run --dart-define API_URL=https://staging-api.creche.dz/api/v1
```

Hot reload OK. Les tokens sont stockés en secure storage (émulateur : keychain simulée).

## 3. Authentification

- Même endpoint que admin-web : `POST /auth/login` (email + password)
- Si TOTP activé, second écran code 6 chiffres
- Refresh auto single-flight (comme parent-mobile) : si 401 → refresh → rejoue
- Si refresh échoue ou époque révoquée (G4) → purge + retour login (L3)

Rôles autorisés : `director`, `receptionist` (selon org), `super_admin`. Les éducatrices utilisent staff-mobile.

## 4. Build release

### Keystore (une fois)

```bash
keytool -genkey -v -keystore android/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Créer `android/key.properties` (jamais commité) :

```
storeFile=/chemin/absolu/upload-keystore.jks
storePassword=xxx
keyAlias=upload
keyPassword=xxx
```

### APK / AAB

```bash
flutter build apk --release
flutter build appbundle --release
```

CI : si secrets `ANDROID_KEYSTORE_BASE64` présents → APK/AAB signés publiables, sinon `ALLOW_DEBUG_SIGNING=true` → APK debug-signed (vérif build uniquement).

## 5. Fonctionnalités V1 (livrées)

| Écran | Endpoint | Notes | Statut |
|-------|----------|-------|--------|
| Dashboard | `GET /dashboard/summary` | salles + ratios + 5 alertes + cache 5 min + offline banner | ✅ |
| Présences | `GET /attendance/summary` + `/attendance/ratios` | filtre date | ✅ |
| Couverture | `GET /staff/schedule/coverage` | planifiés vs présents vs requis + gaps | ✅ |
| Facturation | `GET /billing/invoices/aged-balance` + `/billing/invoices` | filtre statut + cache | ✅ |
| Facture détail | `GET /billing/invoices/:id` + actions send/mark-overdue/reminder | + génération mensuelle | ✅ |
| Enfants | `GET /children` + `GET /children/:id` | search + détail FR/AR | ✅ |
| Staff | `GET /staff/profiles` + `/staff/documents/expiring` + `/staff/schedule/coverage` | + docs expirants | ✅ |
| Journal | `GET /journal/events` | filtre type/date | ✅ |
| Paie | `GET /payroll/runs` + `GET /payroll/runs/:id` + entries | lecture seule V1 + détail | ✅ |
| Attestations | `GET /attestations` | frais garde | ✅ |
| Exports | `GET /exports` | Excel | ✅ |
| Sites & Salles | `GET /sites` + `GET /rooms` | expansion | ✅ |
| Notifs | `GET /notifications/inbox` | | ✅ |
| Settings | `GET /auth/me` + `/organizations/me` | profil + org + logout + purge cache | ✅ |
| More | — | grid 3 col vers 8 sous-écrans | ✅ |

Aucune nouvelle route backend en V1.

## 6. Tests

```bash
flutter test
```

Tests :
- `api_client_test.dart` : token store + error mapping + construction client
- `widget_test.dart` : rendu LoginPage

## 7. CI

Job `flutter-check` dans `.github/workflows/flutter.yml` :
- `pub get --enforce-lockfile` (si lockfile versionné)
- `flutter analyze`
- `flutter test`
- `flutter build apk --release` (3 apps)
- Vérif APK présents + upload artefacts

Le job est non bloquant (branch protection = `database` uniquement), mais doit rester vert.

## 8. Sécurité

- Tokens en `flutter_secure_storage`, jamais loggés
- Pas de PII dans logs
- RLS côté API : toute table avec `organization_id` a `USING` + `WITH CHECK`
- Époque G4 : `users.token_epoch` bump → JWT invalide → app revient login
- Audit `check-secrets-leaked` : keystore jamais commité

## 9. Dépannage

| Symptôme | Cause | Fix |
|----------|-------|-----|
| `P1-2 : aucun keystore` | Pas de keystore + pas de ALLOW_DEBUG_SIGNING | `ALLOW_DEBUG_SIGNING=true flutter build apk --release` ou créer key.properties |
| 401 boucle | Refresh token expiré | Déconnexion auto → re-login |
| Offline | Pas de réseau | SnackBar + bouton Réessayer |
| Dashboard vide | Pas de salles/enfants | Vérifier seeds org |

## 10. Roadmap

- D1 ✅ scaffold + auth + thème + navigation
- D2 ✅ dashboard + ratios + alertes
- D3 ✅ présences
- D4 ✅ facturation + aged-balance + détail
- D5 ✅ enfants / staff / journal / paie / notifs
- D6 ⏳ polish UI + push FCM V2 + graphiques V2

Voir `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` pour détail.
