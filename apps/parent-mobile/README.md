# @creche/parent-mobile — Application Parents (Flutter)

> **Squelette — à générer avec le SDK Flutter** (non disponible dans l'environnement de construction actuel).

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
