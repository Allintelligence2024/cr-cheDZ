# @creche/staff-mobile — Application Personnel (Flutter, offline-first)

> **Squelette prêt à matérialiser** — le SDK Flutter n'est pas disponible dans
> l'environnement de construction CI actuel. Pour activer l'app :

```bash
# 1. Créer le projet (structure de base) puis copier ce squelette par-dessus
flutter create --org dz.creche --project-name staff_mobile --platforms ios,android .
# 2. Récupérer les dépendances
flutter pub get
# 3. Générer le code Drift (tables typées)
dart run build_runner build --delete-conflicting-outputs
# 4. Vérifier et tester
flutter analyze
flutter test
```

## Structure

```
lib/
├── main.dart                 Entrée — MaterialApp, thème FR/AR
├── core/
│   ├── database/app_database.dart     Drift : tables locales (C09 : siteId inclus)
│   ├── auth/                           tokens (secure storage) + login
│   ├── network/                        client API + sync client
│   └── sync/sync_engine.dart           moteur de synchronisation (push/pull)
├── features/
│   ├── children/                       liste des enfants par section (locale)
│   └── sync/                           bannière d'état (SyncBanner)
└── shared/widgets/                     avatar enfant
```

## Corrections C09 déjà intégrées (vs doc d'origine)

1. `LocalChildren.siteId` présent (le code de `checkIn` l'utilise).
2. Widget renommé `SyncBanner` (conflit avec `Material.Banner`).
3. Clé de réponse `next_cursor` (pas `nextcursor`).
4. SyncEngine : backoff exponentiel + déclenchement sur reconnexion
   (connectivity_plus) + au démarrage de l'app.
