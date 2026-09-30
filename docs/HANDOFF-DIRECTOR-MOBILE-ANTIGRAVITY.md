# HANDOFF — Agent Antigravity : Application Direction Mobile (V2 finitions manuelles)

> **Contexte** : tu es un agent Antigravity (accès VPN + secrets + navigateur + Flutter SDK + Xcode).
> Tu exécutes les items restants du plan `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` §7-8 que la sandbox ne peut PAS automatiser.
> Tout le code V1+V2 est déjà commité sur la branche `arena/01a0eb9e-cr-chedz` — ton job est **configurer + builder + valider sur device réel**, pas de nouveau code métier sauf ce qui est explicitement demandé.
>
> **Branche** : `arena/01a0eb9e-cr-chedz` (déjà pushed sur origin).
> **Repo** : `https://github.com/Allintelligence2024/cr-cheDZ.git`.
> **Plan** : `docs/PLAN-APPLICATION-DIRECTION-MOBILE.md` + `docs/IOS-BUILD-DIRECTOR.md` + `docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md`.
> **Règles** :
> - Secrets viennent du vault, jamais dans le repo (vérifié par `check-secrets-leaked`).
> - Chaque item = 1 commit séparé + 1 ligne dans la table de validation en fin de ce fichier.
> - Builds signés uniquement avec keystore prod (jamais debug en prod).
> - En cas de doute, lis `docs/RUNBOOKS-INDEX.md` (ordre : HANDOFF → LOCAL-RUN → RUNBOOKS-INDEX → runbook thématique).

---

## État actuel (fait en sandbox)

| Phase | Description | Commit |
|-------|-------------|--------|
| D1-D5 | Scaffold + auth + dashboard + présences + billing + enfants/staff/journal/paie/notifs | `420b253` |
| D6 | Polish + cache + offline banner + MorePage + attestations/exports/sites/settings/coverage | `420b253` |
| V2.2 | Graphiques fl_chart (AttendanceChart Line + BillingChart Pie) | `09f4826` |
| V2.3 | Écritures : create child, change room, check-in/out, staff check, incident, pay invoice, generate invoices | `09f4826` |
| V2.4 | Offline cache (CacheService 5min + DirectorDatabase wrapper + Drift deps) | `09f4826` |
| V2.5 | Biométrie local_auth + share_plus + org switch + vidéo placeholder + push_service placeholder | `09f4826` |
| V2.6 doc | iOS build doc + android signature P1-2 | `09f4826` |
| CI | flutter.yml build 3 APK + AAB | `420b253` |

**Reste manuel** : tout ce qui nécessite Firebase console, Apple Developer, Play Console, device réel, vault.

---

## ITEM M1 — Firebase FCM (V2.1) — 2 heures

### Pré-requis
- Compte Firebase (console.firebase.google.com) — projet `creche-dz`
- Vault : `FIREBASE_*` si existant

### Étapes

```bash
# 1. Créer projet Firebase creche-dz (si pas existant)
# Console : Nouveau projet → creche-dz → Analytics OFF (ou ON)

# 2. Ajouter app Android
# Console → Project Settings → Add app Android
# Package : com.creche.director_mobile (et aussi staff_mobile + parent_mobile si pas fait)
# Download google-services.json → placer dans :
#   apps/director-mobile/android/app/google-services.json
#   apps/staff-mobile/android/app/google-services.json
#   apps/parent-mobile/android/app/google-services.json
# JAMAIS committer : ajouter à .gitignore (déjà ? vérifier)

# 3. Ajouter app iOS (pour plus tard)
# Package : com.creche.directorMobile (iOS bundle)
# Download GoogleService-Info.plist → ios/Runner/GoogleService-Info.plist

# 4. Activer Cloud Messaging
# Console → Cloud Messaging → créer certificat APNs (pour iOS) → upload .p8 depuis Apple Developer

# 5. Dans le code : remplacer placeholder push_service.dart
#   - Ajouter deps dans pubspec.yaml :
#     firebase_core: ^2.24.0
#     firebase_messaging: ^14.9.0
#   - Dans main.dart : await Firebase.initializeApp()
#   - Dans push_service.dart : remplacer TODO par vrai FirebaseMessaging
#   - Dans main.dart DirectorHome : _push.onMessage.listen -> show SnackBar + badge

# 6. Test local
cd apps/director-mobile
flutter pub get
flutter run --dart-define API_URL=https://staging-api.creche.dz/api/v1
# Envoyer message test depuis Firebase Console → Cloud Messaging → Send test message (FCM token du log)

# 7. Enregistrer FCM token côté API
#   Le staff-mobile le fait déjà via POST /devices {fcm_token}
#   Pour director-mobile, ajouter dans DirectorHome initState :
#     final token = await _push.getToken();
#     if (token != null) await api.registerDevice(fcm_token: token) — endpoint déjà existant

# 8. Commit (sans google-services.json !)
git add apps/director-mobile/lib/core/push_service.dart apps/director-mobile/lib/main.dart apps/director-mobile/pubspec.yaml
git commit -m "feat(director-mobile, m1): FCM réel Firebase (Android + iOS) + enregistrement token"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : notification test reçue en < 5s sur device réel, token enregistré en base `devices.fcm_token`.

---

## ITEM M2 — Drift génération + offline complet (V2.4) — 1 heure

### Pré-requis
- Flutter 3.47.1 installé (tu l'as, sandbox non)

### Étapes

```bash
cd apps/director-mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
# Attendu : génère lib/core/database/app_database.g.dart (ou app_database_drift.g.dart)
# Vérifier que le fichier contient $CachedDashboardTable etc.

# Remplacer le wrapper SharedPreferences par le vrai Drift si tu veux
# Option A : garder wrapper actuel (fonctionnel sans génération) — le plus simple
# Option B : migrer DirectorDatabase vers Drift typé :
#   - Créer lib/core/database/app_database_drift.dart avec @DriftDatabase(tables: [...])
#   - Générer g.dart
#   - Dans dashboard_page, remplacer CacheService par DirectorDatabase pour offline

# Lancer tests
flutter test
# Attendu : tous verts

# Commit
git add apps/director-mobile/lib/core/database/
git commit -m "feat(director-mobile, m2): génération Drift + offline DB (director_cache.db)"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : `flutter analyze` vert, `app_database.g.dart` présent, tests verts.

---

## ITEM M3 — Keystore production (P1-2) — 30 min

### Pré-requis
- Vault pour mots de passe
- Accès local sécurisé (jamais committer keystore)

### Étapes

```bash
# Générer keystore prod (si pas existant)
cd apps/director-mobile/android
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
# Mots de passe : depuis vault (ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD)

# Créer android/key.properties (NON commité, .gitignore OK)
cat > android/key.properties <<EOF
storeFile=/absolute/path/to/apps/director-mobile/android/upload-keystore.jks
storePassword=$ANDROID_KEYSTORE_PASSWORD
keyAlias=upload
keyPassword=$ANDROID_KEY_PASSWORD
EOF

# Encoder en base64 pour CI (GitHub Secrets)
base64 -w0 android/upload-keystore.jks > /tmp/keystore.b64
echo "Copier /tmp/keystore.b64 dans GitHub Secret ANDROID_KEYSTORE_BASE64"
echo "Secrets requis : ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS=upload, ANDROID_KEY_PASSWORD"

# Vérifier que .gitignore contient key.properties + *.jks (déjà dans staff-mobile, copié)
cat android/.gitignore | grep key.properties

# PAS de commit de keystore — juste doc
echo "Keystore prod généré le $(date) par $USER" >> docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md
git add docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md
git commit -m "docs(director-mobile, m3): keystore prod généré + secrets CI configurés"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : `flutter build apk --release` réussit SANS `ALLOW_DEBUG_SIGNING=true`, APK signé avec cert prod.

---

## ITEM M4 — Build Android signé + Play Console (V2.6) — 2 heures

### Pré-requis
- M3 fait (keystore prod)
- Compte Play Console (play.google.com/console) — organisation Crèche DZ
- Accès vault

### Étapes

```bash
cd apps/director-mobile
flutter clean
flutter pub get
flutter build apk --release
flutter build appbundle --release

# Vérifier
ls -lh build/app/outputs/flutter-apk/app-release.apk
ls -lh build/app/outputs/bundle/release/app-release.aab
# Taille attendue : APK ~20-30 Mo, AAB ~15-25 Mo

# Vérifier signature
jarsigner -verify -verbose -certs build/app/outputs/bundle/release/app-release.aab | head

# Upload Play Console
# Console → Crèche DZ Direction → Production → Nouveau → Upload AAB
# Remplir : notes de version FR/AR, screenshots (voir M8), CGU (docs/regulatory)
# Piste interne d'abord, puis fermée, puis prod

# Commit (juste logs, pas APK)
git add docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md
git commit -m "feat(director-mobile, m4): build AAB signé + upload Play Console interne"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : AAB uploadé en piste interne, installable depuis Play Store interne.

---

## ITEM M5 — Build iOS + TestFlight (V2.6) — 1 jour

### Pré-requis
- macOS + Xcode 15+ (tu l'as)
- Compte Apple Developer (99$/an) — Team ID depuis vault
- M1 fait (GoogleService-Info.plist pour FCM iOS)
- Certificats APNs pour push

### Étapes

```bash
cd apps/director-mobile

# Générer dossier ios (si pas existant)
flutter create --platforms ios .

# Ouvrir dans Xcode
open ios/Runner.xcworkspace

# Config Xcode :
# - Team : sélectionner team Apple
# - Bundle ID : com.creche.director-mobile (ou com.creche.directorMobile selon ce qui est dispo)
# - Version : 0.2.0, Build : 1
# - Capabilities : Push Notifications + FaceID
# - Info.plist ajouter :
#   NSFaceIDUsageDescription = Authentification rapide directrice
#   UIBackgroundModes = remote-notification

# Placer GoogleService-Info.plist dans ios/Runner/

# Pod install
cd ios && pod install && cd ..

# Build ipa
flutter build ipa --release --dart-define API_URL=https://api.creche.dz/api/v1

# Upload TestFlight
# Xcode → Window → Organizer → Distribute App → TestFlight
# Ou via Transporter

# Inviter testeuses (directrices pilotes) dans TestFlight

# Commit
git add docs/IOS-BUILD-DIRECTOR.md
git commit -m "feat(director-mobile, m5): build ipa + TestFlight + FaceID + Push capability"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : build disponible dans TestFlight, installable sur iPhone, FaceID fonctionne, push reçu.

---

## ITEM M6 — Device farm Android 2 Go RAM + perf (ROADMAP_V2 P1) — 3 heures

### Pré-requis
- Device réel Android 2 Go RAM (ou émulateur avec 2 Go)
- Ou Firebase Test Lab / AWS Device Farm

### Étapes

```bash
# Créer émulateur 2 Go si pas de device réel
# Android Studio → AVD → New → RAM 2048 Mo, heap 256 Mo, API 33

# Lancer app director-mobile en release
cd apps/director-mobile
flutter run --release --dart-define API_URL=https://staging-api.creche.dz/api/v1

# Mesures à noter (dans docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md) :
# - Temps démarrage cold start (cible < 3s)
# - RAM utilisée (Android Profiler, cible < 150 Mo)
# - Dashboard load p95 (cible < 2s, comme test:capacity)
# - Scroll fluide (60 fps, pas de jank)
# - Listes virtuelles si > 100 enfants

# Si RAM > 150 Mo : activer shrinkResources + proguard (build.gradle.kts isMinifyEnabled=true)
# + listes virtuelles (ListView.builder déjà OK)

# Test terrain 8h offline (comme staff-mobile)
# - Charger dashboard, couper réseau, vérifier cache 5 min + offline banner
# - Reconnecter, pull-to-refresh

# Commit mesures
cat >> docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md << 'EOF'

## Mesures device farm 2 Go (JJ/MM/AAAA)
- Cold start: __ s
- RAM: __ Mo
- Dashboard p95: __ ms
- Jank: __ (oui/non)
- Offline 8h: __ (OK/KO)
EOF
git add docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md
git commit -m "perf(director-mobile, m6): mesures device farm 2 Go RAM"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : cold start < 3s, RAM < 150 Mo, dashboard p95 < 2s, offline 8h OK.

---

## ITEM M7 — Sentry + observabilité (ROADMAP_V2 P1) — 1 heure

### Pré-requis
- Compte Sentry (sentry.io) — projet `director-mobile`
- Vault : SENTRY_DSN

### Étapes

```bash
# Créer projet Sentry : director-mobile (Flutter)

# Ajouter dep
cd apps/director-mobile
flutter pub add sentry_flutter

# Dans main.dart, avant runApp :
# import 'package:sentry_flutter/sentry_flutter.dart';
# await SentryFlutter.init((o) => o.dsn = const String.fromEnvironment('SENTRY_DSN', defaultValue: 'https://xxx@yyy.ingest.sentry.io/zzz'), appRunner: () => runApp(...))

# Build avec --dart-define SENTRY_DSN=...

# Test : throw Exception('test sentry') dans un bouton caché (MorePage)

# Vérifier dans Sentry dashboard : event reçu

# Commit
git add apps/director-mobile/lib/main.dart apps/director-mobile/pubspec.yaml
git commit -m "feat(director-mobile, m7): Sentry Flutter (DSN via --dart-define)"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : event test visible dans Sentry < 1 min.

---

## ITEM M8 — Screenshots + Play Store listing + CGU (P3-3, P3-1) — 2 heures

### Pré-requis
- Device réel ou émulateur avec données staging (5 crèches pilotes)
- Accès Play Console + App Store Connect

### Étapes

```bash
# Lancer app avec données staging
cd apps/director-mobile
flutter run --dart-define API_URL=https://staging-api.creche.dz/api/v1

# Screenshots (FR + AR) :
# - Dashboard avec ratios + graphiques
# - Présences par salle
# - Facturation aged-balance + PieChart
# - Enfants liste + détail
# - Staff couverture + docs expirants
# - Journal incidents
# - MorePage grid

# Outil : flutter screenshot ou manuel via Android Studio

# Placer dans docs/design/screenshots-director/ (créer dossier)

# Play Store listing
# Console → Listing principal :
# - Titre : Crèche DZ — Direction
# - Description courte : Cockpit directrice — présences, ratios, facturation
# - Description longue : FR + AR (voir docs/regulatory pour CGU)
# - Screenshots : 3-8 par langue
# - Icône : même que staff-mobile (teal) mais avec badge direction
# - Catégorie : Business
# - Coordonnées : support@creche.dz
# - CGU + Politique confidentialité : URL https://creche.dz/cgu + /privacy (à créer si pas existant, voir P3-3)

# App Store listing similaire

# Commit
git add docs/design/screenshots-director/ 2>/dev/null || echo "Pas de screenshots commités (binaires) — doc seulement"
cat >> docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md << 'EOF'

## Store listing (JJ/MM/AAAA)
- Screenshots FR: __ images
- Screenshots AR: __ images
- Description FR/AR: ✅
- CGU URL: __
- Privacy URL: __
EOF
git add docs/PHASE_H2_DIR_MOBILE_RUNBOOK.md
git commit -m "docs(director-mobile, m8): screenshots + store listing FR/AR + CGU"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : listing complet en brouillon Play Console + App Store, screenshots FR/AR.

---

## ITEM M9 — Tests pilotes directrices (PILOT-PROTOCOL) — 2 semaines

### Pré-requis
- M4 + M5 faits (APK/AAB + IPA disponibles)
- 5 crèches pilotes onboardées (cf. docs/PILOT-PROTOCOL.md)
- Canal Slack/email #pilotes-direction

### Étapes

```bash
# Distribuer app
# Android : lien Play Store interne
# iOS : invitation TestFlight

# Former directrices (30 min par crèche) :
# - Login + dashboard 30s pour voir si tout va bien
# - Présences + ratios
# - Facturation impayés + relance
# - Journal incidents
# - Feedback quotidien via formulaire

# Métriques à collecter (comme PILOT-PROTOCOL) :
# - Utilisation quotidienne (DAU)
# - Temps dashboard < 30s ?
# - Nombre incidents signalés depuis mobile
# - Nombre factures relancées depuis mobile
# - Crash-free rate (Sentry)

# Hotfixes si besoin (branche arena/01a0eb9e-cr-chedz)

# Bilan go/no-go (fin S15 du PLAN_IMPLEMENTATION)
# Si OK → prod (S16)

# Commit bilan
cat >> docs/PILOT-PROTOCOL.md << 'EOF'

## Bilan pilotes direction (JJ/MM/AAAA)
- 5 crèches × 2 semaines : __ DAU
- Dashboard 30s : __ (oui/non)
- Incidents mobile : __
- Relances mobile : __
- Crash-free : __ %
- Go-live : __ (oui/non)
EOF
git add docs/PILOT-PROTOCOL.md
git commit -m "docs(director-mobile, m9): bilan pilotes direction 5 crèches"
git push origin arena/01a0eb9e-cr-chedz
```

**Critère** : 5 crèches × 2 semaines utilisation quotidienne, 0 incident bloquant non résolu 24h, go-live validé.

---

## Récapitulatif à renvoyer à l'opérateur principal

Une fois tous les items M1-M9 validés, commit final :

```bash
cat >> docs/HANDOFF-DIRECTOR-MOBILE-ANTIGRAVITY.md << 'EOF'

## Validation finale (JJ/MM/AAAA)

| ID | Description | Statut | Date |
|----|-------------|--------|------|
| M1 | FCM réel Firebase | ✅ | JJ/MM/AAAA |
| M2 | Drift génération | ✅ | JJ/MM/AAAA |
| M3 | Keystore prod | ✅ | JJ/MM/AAAA |
| M4 | Build AAB signé + Play interne | ✅ | JJ/MM/AAAA |
| M5 | Build IPA + TestFlight | ✅ | JJ/MM/AAAA |
| M6 | Device farm 2 Go RAM | ✅ | JJ/MM/AAAA |
| M7 | Sentry | ✅ | JJ/MM/AAAA |
| M8 | Screenshots + listing FR/AR | ✅ | JJ/MM/AAAA |
| M9 | Pilotes 5 crèches | ✅ | JJ/MM/AAAA |

→ **App Direction prête prod** : ouvrir PR vers main + checklist go-live docs/RUNBOOKS-INDEX.md §4.

Validé par : ____________
EOF
git add docs/HANDOFF-DIRECTOR-MOBILE-ANTIGRAVITY.md
git commit -m "docs(director-mobile): validation finale M1-M9 (prod ready)"
git push origin arena/01a0eb9e-cr-chedz
```

**Porte prod atteinte** :
- ✅ M1 FCM
- ✅ M2 Drift
- ✅ M3 Keystore
- ✅ M4 Play
- ✅ M5 TestFlight
- ✅ M6 Device farm
- ✅ M7 Sentry
- ✅ M8 Store listing
- ✅ M9 Pilotes

→ **Go-live signé**.

---

## En cas de blocage

1. **Firebase refusé** : vérifier SHA-1 du keystore (`keytool -list -v -keystore upload-keystore.jks`) + package name exact `com.creche.director_mobile`.
2. **Build iOS échoue** : `pod repo update` + `flutter clean` + vérifier Team + Bundle ID + GoogleService-Info.plist.
3. **APK non installable** : vérifier signature `jarsigner -verify` + versionCode incrémenté dans pubspec.yaml.
4. **Push non reçu** : logs `adb logcat | grep -i fcm` + vérifier `devices.fcm_token` en base + topic subscription.
5. **Biométrie non dispo** : émulateur sans empreinte → tester sur device réel uniquement.
6. **Vault inaccessible** : contact OPS principal. NE PAS hardcoder secrets (check-secrets-leaked).

---

*Ce fichier a été généré le 2026-09-29 par l'agent Arena (sandbox sans Flutter/iOS/Firebase). Il sert de passation vers l'agent Antigravity qui a les accès.*
