/// ITEM M7 — observabilité Sentry.
///
/// Le DSN n'est JAMAIS dans le repo : il arrive au build par
/// `--dart-define SENTRY_DSN=...` (secret GitHub Actions `SENTRY_DSN`,
/// jamais commité — vérifié par `check-secrets-leaked`).
///
/// Comportement :
/// * DSN absent (dev local, CI, tests widget) → Sentry n'est PAS initialisé :
///   aucun appel réseau, aucun bruit, l'app tourne normalement.
/// * DSN présent → `SentryFlutter.init` entoure `runApp` : erreurs Flutter,
///   erreurs de plateforme et `Future` non catchées remontent au projet
///   `director-mobile`. `sendDefaultPii = false` : aucune donnée personnelle
///   envoyée (conformité P3-1 / RGPD algérien — cf. docs/regulatory).
library;

import 'package:sentry_flutter/sentry_flutter.dart';

/// DSN fourni au build (`--dart-define SENTRY_DSN=https://…@….ingest.sentry.io/…`).
const String sentryDsn = String.fromEnvironment('SENTRY_DSN');

/// Environnement logique (`--dart-define SENTRY_ENVIRONMENT=staging|prod`).
const String sentryEnvironment =
    String.fromEnvironment('SENTRY_ENVIRONMENT', defaultValue: 'staging');

/// true seulement au build de test Sentry
/// (`--dart-define SENTRY_TEST_CRASH=true`) : affiche dans « Plus » une entrée
/// qui lève une exception contrôlée, pour vérifier la chaîne de reporting.
const bool sentryTestCrashEnabled =
    bool.fromEnvironment('SENTRY_TEST_CRASH');

/// Configuration Sentry utilisée par `main()` (DSN vide = jamais appelé).
void applySentryOptions(SentryFlutterOptions options) {
  options
    ..dsn = sentryDsn
    // 20 % des traces : le cockpit est consulté en boucle par les directrices,
    // on garde le volume (et le coût) sous contrôle.
    ..tracesSampleRate = 0.2
    // Pas de PII : l'app manipule des données d'enfants mineurs.
    ..sendDefaultPii = false
    ..environment = sentryEnvironment;
}
