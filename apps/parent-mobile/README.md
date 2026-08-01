# @creche/parent-mobile — Application Parents (Flutter)

> **Squelette — à générer avec le SDK Flutter** (non disponible dans l'environnement de construction actuel).

## État d’implémentation

Le manifeste Flutter et une racine `lib/main.dart` (FR/AR, délégation RTL et flux d’absence) sont présents. **Flutter/Dart n’est pas installé dans cette sandbox**, donc `flutter analyze`, tests widgets et golden RTL restent à exécuter dans la CI/mobile locale après `flutter pub get`.

L’API Phase 7 expose `/parent/*` : enfants liés, fil autorisé par `child_guardians.can_view_journal`, absence, consentements, préférences avec quiet hours, et URL photo signée seulement si visible aux parents.

## Création du projet

```bash
flutter create --org dz.creche --project-name parent_mobile --platforms ios,android apps/parent-mobile
```

## Périmètre (phases)

| Phase | Contenu |
|---|---|
| P7 | Authentification OTP téléphone + PIN · fil du jour de l'enfant · photos (URLs signées) · signalement d'absence en 2 taps · consentements · RTL arabe |
| P8 | Consultation factures et reçus (lecture seule) |

## Architecture cible

```
lib/
├── core/        (auth, network, theme, l10n AR/FR)
├── features/    (feed, children, consent, absence, billing)
└── shared/      (widgets)
```

Dépendances prévues : `flutter_riverpod`, `dio`, `flutter_secure_storage`, `intl`, `fcm` (firebase_messaging), `local_auth`.
