## Réalité mesurée — chaîne des runs (2026-08-26)

Le job `flutter-check` ne tournait **pas du tout** à l'origine. Trois états successifs :

1. **v1 (`cirruslabs/flutter:stable`)** : `docker pull` → `pull access denied ...
   repository does not exist`. Le conteneur ne démarrait jamais ; `continue-on-error`
   masquait tout en **vert** : un faux vert.
2. **v2 (`subosito/flutter-action`, `flutter-version: stable`)** : échec à
   l'**install** de Flutter — `Unable to determine Flutter version for channel:
   stable version: stable` (`stable` est un channel, pas une version).
3. **v3 (`channel: stable`, sans continue-on-error)** : Flutter **stable
   3.47.1** s'installe et tourne réellement. Le job est maintenant **rouge
   honnête** (non bloquant : seul `database` est requis). Cause réelle ci-dessous.

## Cause réelle du rouge (run PR #12, 32981979665)

`flutter pub get` échoue sur `apps/parent-mobile` :

```
Because parent_mobile depends on flutter_localizations from sdk which depends on intl ^0.20.3, intl ^0.20.3 is required.
So, because parent_mobile depends on intl ^0.19.0, version solving failed.
```
→ `pubspec.yaml` de `parent-mobile` épingle `intl ^0.19.0` alors que
`flutter_localizations` (SDK) exige `intl ^0.20.3`. `staff-mobile` est
vraisemblablement dans le même cas (à confirmer au run). C'est la dette
"jamais compilé" rendue visible.

## Correctif appliqué (CI, hors `apps/`)

- `container: cirruslabs/flutter:stable` → `subosito/flutter-action@v2` +
  `channel: stable` (Flutter réel, cache).
- **RETRAIT de `continue-on-error: true`** → statut honnête. Non bloquant
  (seul `database` requis par la branch protection).

## Nouveau périmètre : build + run

La CI exécute `flutter pub get` + `flutter analyze` sur `apps/parent-mobile`
et `apps/staff-mobile`. Prochaines étapes (suivi ici, **hors P3 — ne pas
toucher `apps/` dans cette mission**) :

1. Résoudre le conflit `intl` : passer `intl` à `^0.20.3` dans les pubspec
   (PR dédiée par le owner).
2. Générer le code Drift (`build_runner`) pour `staff-mobile`
   (`app_database.g.dart` manquant).
3. Monter la CI en `flutter build` (+ `flutter test`) une fois la compile
   obtenue — "build + run" complet.
4. Quand `analyze`/`build` passe, le job devient un vrai garde-fou (et pourra
   redevenir `required` si souhaité).
5. Burn-down lint Dart au passage.
