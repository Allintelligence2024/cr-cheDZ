# iOS Build — Director Mobile

> V2.6 — nécessite macOS + Xcode + compte Apple Developer

## Prérequis

- macOS avec Xcode 15+
- Flutter 3.47.1
- Compte Apple Developer (99$/an) pour TestFlight / App Store
- `ios/Runner.xcodeproj` généré via `flutter create`

## Génération iOS (une fois)

Depuis `apps/director-mobile` :

```bash
flutter create --platforms ios .
# Cela génère ios/ avec Podfile, Runner, etc.
```

## Configuration

1. Ouvrir `ios/Runner.xcworkspace` dans Xcode
2. Team + Bundle ID : `com.creche.director-mobile`
3. Capabilities : Push Notifications (pour FCM), FaceID (NSFaceIDUsageDescription dans Info.plist)
4. Ajouter `GoogleService-Info.plist` (Firebase) dans Runner/
5. Info.plist :

```xml
<key>NSFaceIDUsageDescription</key>
<string>Authentification rapide directrice</string>
<key>UIBackgroundModes</key>
<array>
  <string>remote-notification</string>
</array>
```

## Build

```bash
flutter build ipa --release --dart-define API_URL=https://api.creche.dz/api/v1
```

Upload via Transporter ou Xcode → TestFlight.

## CI

`flutter.yml` ne build pas ipa (nécessite runner macOS + secrets Apple). Ajouter job `macos-latest` si besoin :

```yaml
- uses: subosito/flutter-action@v2
  with:
    flutter-version: '3.47.1'
    channel: stable
- run: cd apps/director-mobile && flutter build ipa --release
```

## Limitations actuelles

- Dossier `ios/` non versionné (généré localement, comme staff-mobile/parent-mobile)
- Pas de Firebase config (google-services.json / GoogleService-Info.plist) — à provisionner depuis console Firebase
- Pas de certificats APNs — à générer depuis developer.apple.com
