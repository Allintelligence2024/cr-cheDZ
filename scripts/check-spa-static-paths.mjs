#!/usr/bin/env node
/**
 * Garde-fou : cohérence entre le `base` Vite d'une SPA, l'emplacement où le
 * Dockerfile copie le bundle, et la racine servie par nginx.
 *
 * Pourquoi ce script existe
 * -------------------------
 * La console support est construite avec `base: '/support/'`. Son index.html
 * demande donc `/support/assets/index-*.js`. Le reverse proxy amont
 * (infrastructure/nginx/nginx.conf) fait `proxy_pass http://support_backend;`
 * SANS slash final : nginx transmet l'URI complète, préfixe /support/ inclus.
 *
 * Si le conteneur copie le bundle à la racine (`/usr/share/nginx/html`), la
 * requête `/support/assets/app.js` ne correspond à aucun fichier, `try_files`
 * retombe sur `/index.html` et le navigateur reçoit du text/html à la place
 * d'un module JavaScript. Résultat : page blanche, sans la moindre erreur au
 * build. Les images Docker sont seulement *construites* en CI, jamais
 * démarrées : rien n'attrape ça avant la production.
 *
 * Ce que le script vérifie, pour chaque SPA déclarée ci-dessous :
 *   1. le `base` du vite.config.ts,
 *   2. le chemin de destination du `COPY --from=build … ` du Dockerfile,
 *   3. la cible du `try_files` de la conf nginx embarquée,
 *   4. si un bundle existe déjà (dist/), que les URLs de son index.html
 *      pointent bien vers des fichiers réellement présents une fois servis.
 *
 * Usage : node scripts/check-spa-static-paths.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** SPAs servies par nginx depuis une image statique. */
const APPS = [
  { name: 'support-console', dir: 'apps/support-console' },
  { name: 'admin-web', dir: 'apps/admin-web' },
];

const NGINX_ROOT = '/usr/share/nginx/html';
const problems = [];

/** Lit `base: '…'` dans un vite.config.ts (défaut Vite : '/'). */
function readViteBase(dir) {
  const file = join(repoRoot, dir, 'vite.config.ts');
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
  const m = src.match(/\bbase:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : '/';
}

/** Destination du `COPY --from=build … <dest>` dans le Dockerfile. */
function readDockerCopyDest(dir) {
  const file = join(repoRoot, dir, 'Dockerfile');
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^COPY\s+--from=build\s+\S+\s+(\S+)\s*$/m);
  return m ? m[1].replace(/\/$/, '') : null;
}

/** Cible du `try_files … /xxx` dans la conf nginx embarquée. */
function readTryFilesFallback(dir) {
  const file = join(repoRoot, dir, 'Dockerfile');
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  const m = src.match(/try_files\s+[^;]*?\s(\/\S*?index\.html)/);
  return m ? m[1] : null;
}

for (const app of APPS) {
  const problemsBefore = problems.length;
  const base = readViteBase(app.dir);
  const dest = readDockerCopyDest(app.dir);
  const fallback = readTryFilesFallback(app.dir);

  if (base === null || dest === null) {
    console.log(`• ${app.name} : pas de vite.config.ts/Dockerfile exploitable — ignoré.`);
    continue;
  }

  // Emplacement attendu du bundle : racine nginx + préfixe `base`.
  const expectedDest = (NGINX_ROOT + base).replace(/\/$/, '');

  if (dest !== expectedDest) {
    problems.push(
      `${app.name} : base Vite '${base}' → le bundle doit être copié dans ` +
        `'${expectedDest}', or le Dockerfile copie dans '${dest}'. ` +
        "Les assets seraient introuvables et try_files renverrait l'index.html " +
        '(page blanche en production).',
    );
  }

  // Le fallback SPA doit pointer sur l'index.html RÉELLEMENT servi.
  const expectedFallback = `${base.replace(/\/$/, '')}/index.html`;
  if (fallback && fallback !== expectedFallback) {
    problems.push(
      `${app.name} : try_files retombe sur '${fallback}' alors que l'index ` +
        `servi est '${expectedFallback}'.`,
    );
  }

  // Si un build existe, vérifier que chaque asset référencé serait résolu.
  const distIndex = join(repoRoot, app.dir, 'dist/index.html');
  if (existsSync(distIndex)) {
    const html = readFileSync(distIndex, 'utf8');
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    for (const url of urls) {
      // Ce que nginx cherchera sur le disque : <dest> vaut <root><base>,
      // donc on retire le préfixe base de l'URL pour retomber sur dist/.
      if (!url.startsWith(base)) {
        problems.push(
          `${app.name} : l'asset '${url}' ne commence pas par le base '${base}'.`,
        );
        continue;
      }
      const relative = url.slice(base.length);
      if (!existsSync(join(repoRoot, app.dir, 'dist', relative))) {
        problems.push(`${app.name} : asset référencé mais absent du bundle : ${url}`);
      }
    }
  }

  const appProblems = problems.length - problemsBefore;
  console.log(
    `• ${app.name} : base='${base}', COPY → '${dest}'` +
      (fallback ? `, try_files → '${fallback}'` : '') +
      (appProblems === 0 ? ' — OK' : ` — ${appProblems} problème(s)`),
  );
}

if (problems.length > 0) {
  console.error('\n❌ Incohérences base Vite / nginx :\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nCes erreurs ne se voient pas au build : l\'image se construit très bien ' +
      'et la page est blanche au runtime.\n',
  );
  process.exit(1);
}

console.log('\n✅ Chemins statiques cohérents (base Vite ↔ COPY Docker ↔ nginx).');
