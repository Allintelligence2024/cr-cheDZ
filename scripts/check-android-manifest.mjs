#!/usr/bin/env node
/**
 * GARDE MANIFEST ANDROID (plan de correction 2026-09, Phase B — finding C7).
 *
 * Le bug : le scaffolding généré par `flutter create` ne déclare
 * `android.permission.INTERNET` QUE dans `app/src/debug/AndroidManifest.xml`
 * et `app/src/profile/AndroidManifest.xml`. Le manifest `app/src/main/`
 * n'a aucune permission.
 *
 * Conséquence : `flutter build apk --release` produit un APK SANS AUCUN ACCÈS
 * RÉSEAU — incapable de joindre l'API. Or ces deux apps sont des clients d'une
 * API (sync, journal, notifications) : l'APK release est inutilisable.
 *
 * Pourquoi ce garde existe : la CI ne peut PAS le voir autrement.
 * `flutter-check` exécute `pub get` + `analyze`, qui ne lisent jamais les
 * manifests. `flutter run` / `--debug` / `--profile` fusionnent INTERNET et
 * fonctionnent donc parfaitement — le bug n'apparaît qu'en release, c'est-à-dire
 * uniquement sur un device réel ou en étape B4/B5 de l'issue #8.
 * Un `flutter create` régénéré réintroduirait aussi le trou silencieusement.
 *
 * Usage : node scripts/check-android-manifest.mjs [--verbose]
 * Exit  : 0 = conforme · 1 = au moins un manifest non conforme · 2 = introuvable
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/** Permissions exigées dans le manifest `main/` — donc présentes en release. */
const REQUIRED_IN_MAIN = ['android.permission.INTERNET'];

/**
 * Permissions attendues pour le bon fonctionnement, mais dont l'absence n'est
 * pas bloquante (signalée en avertissement) : elles dépendent de features qui
 * peuvent ne pas encore être câblées côté Dart.
 */
const RECOMMENDED_IN_MAIN = [
  // Android 13+ (API 33) : les notifications runtime sont refusées sans ceci.
  // Le worker envoie des push FCM (apps/worker/src/main.ts fcmSend).
  'android.permission.POST_NOTIFICATIONS',
  // Bannière offline du SyncEngine : détecter l'état du réseau.
  'android.permission.ACCESS_NETWORK_STATE',
];

const log = (message) => console.log(message);
const verbose = (message) => {
  if (VERBOSE) console.log(`  ${message}`);
};

/** Retrouve les apps Flutter du monorepo (celles qui ont un dossier android/). */
function discoverFlutterApps() {
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(appsDir, name, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')));
}

/** Extrait les <uses-permission> déclarés d'un manifest. */
function readPermissions(manifestPath) {
  const content = readFileSync(manifestPath, 'utf8');
  // Retire les commentaires XML : le template Flutter contient INTERNET dans un
  // bloc commenté côté debug/profile, il ne doit pas compter comme déclaré.
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const found = new Set();
  const pattern = /<uses-permission[^>]+android:name\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    found.add(match[1]);
  }
  return { permissions: found, raw: content };
}

let failures = 0;
let warnings = 0;

const apps = discoverFlutterApps();

if (apps.length === 0) {
  log("⚠ Aucune app Flutter avec un dossier android/ trouvée — le scaffolding Android n'existe pas encore.");
  log('  Attendu : apps/<app>/android/app/src/main/AndroidManifest.xml');
  log('  (Étape B1 de l\'issue #8 — voir docs/PLAN_CORRECTION_AUDIT_2026-09.md, Phase B.)');
  process.exit(2);
}

log(`Vérification de ${apps.length} app(s) Flutter : ${apps.join(', ')}`);
log('');

for (const app of apps) {
  const mainManifest = join(ROOT, 'apps', app, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const { permissions } = readPermissions(mainManifest);

  verbose(`${app}/main : ${permissions.size} permission(s) déclarée(s)${permissions.size ? ` → ${[...permissions].join(', ')}` : ''}`);

  const missing = REQUIRED_IN_MAIN.filter((permission) => !permissions.has(permission));
  const missingRecommended = RECOMMENDED_IN_MAIN.filter((permission) => !permissions.has(permission));

  if (missing.length > 0) {
    failures += missing.length;
    log(`✗ ${app} — permission(s) MANQUANTE(S) dans app/src/main/AndroidManifest.xml :`);
    for (const permission of missing) {
      log(`    ${permission}`);
    }
    log(`  → Un \`flutter build apk --release\` produirait un APK SANS ACCÈS RÉSEAU.`);
    log(`  → Correctif : ajouter avant <application> dans ${app}/android/app/src/main/AndroidManifest.xml :`);
    for (const permission of missing) {
      log(`      <uses-permission android:name="${permission}"/>`);
    }
    log('');
  }

  if (missingRecommended.length > 0) {
    warnings += missingRecommended.length;
    log(`⚠ ${app} — permission(s) recommandée(s) absente(s) (non bloquant) :`);
    for (const permission of missingRecommended) {
      log(`    ${permission}`);
    }
    log('');
  }

  if (missing.length === 0 && missingRecommended.length === 0) {
    log(`✓ ${app} — manifest main conforme`);
  } else if (missing.length === 0) {
    log(`✓ ${app} — permissions requises présentes`);
  }

  // Contrôle secondaire : debug/profile doivent aussi avoir INTERNET, sinon
  // `flutter run` échoue et le développeur croira à un bug réseau.
  for (const variant of ['debug', 'profile']) {
    const variantManifest = join(ROOT, 'apps', app, 'android', 'app', 'src', variant, 'AndroidManifest.xml');
    if (!existsSync(variantManifest)) {
      verbose(`${app}/${variant} : manifest absent (variante non générée)`);
      continue;
    }
    const variantPerms = readPermissions(variantManifest).permissions;
    if (!variantPerms.has('android.permission.INTERNET') && !permissions.has('android.permission.INTERNET')) {
      failures += 1;
      log(`✗ ${app} — INTERNET absent de ${variant}/ ET de main/ : \`flutter run\` n'aura pas de réseau`);
      log('');
    }
  }
}

log('────────────────────────────────────────────');
if (failures > 0) {
  log(`✗ ${failures} échec(s), ${warnings} avertissement(s) — APK release non fonctionnel(s).`);
  log('  Contexte : docs/PLAN_CORRECTION_AUDIT_2026-09.md, Phase B (finding C7).');
  process.exit(1);
}
log(`✓ Manifests Android conformes (${apps.length} app(s), ${warnings} avertissement(s)).`);
log('  Un build release aura bien l\'accès réseau.');
process.exit(0);
