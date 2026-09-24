#!/usr/bin/env node
/**
 * Contrat des en-têtes de bord (plan de réparation 2026-09-24, lot 1).
 *
 * Le dépôt n'avait AUCUNE Content-Security-Policy (0 occurrence dans tous les
 * fichiers, `grep -ri "content-security-policy"`). Ce test existe pour que la
 * politique ne puisse pas disparaître silencieusement — et pour que sa portée
 * reste HONNÊTE : il vérifie les directives structurantes réellement écrites,
 * pas une intention.
 *
 * Il vérifie aussi l'hypothèse qui rend une seule politique suffisante : les
 * deux SPA (admin-web, support-console) ne publient AUCUN port en production —
 * seul le bord est joignable. Si quelqu'un publie un port, ce test échoue et
 * rappelle qu'il faut alors une CSP aussi dans les conteneurs SPA.
 *
 * Aucune base, aucun Docker : lecture de fichiers. Exécuté par Gate D
 * (scripts/test-production-roles.mjs) à côté des autres contrats.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const nginx = readFileSync('infrastructure/nginx/nginx.conf', 'utf8');

/** Valeur de l'en-tête CSP, telle qu'écrite dans le fichier de bord. */
function cspValue() {
  const match = /^\s*add_header Content-Security-Policy "(.*)" always;$/m.exec(nginx);
  assert.ok(match, 'aucune Content-Security-Policy dans infrastructure/nginx/nginx.conf');
  return match[1];
}

test('le bord sert une CSP avec les directives structurantes', () => {
  const value = cspValue();
  const directives = new Map(
    value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name, sources];
    }),
  );
  for (const required of [
    'default-src', 'script-src', 'style-src', 'img-src', 'media-src',
    'connect-src', 'object-src', 'base-uri', 'frame-ancestors', 'form-action',
  ]) {
    assert.ok(directives.has(required), `directive manquante dans la CSP : ${required}`);
  }
  assert.deepEqual(directives.get('default-src'), ["'self'"], 'default-src doit rester fermé à l\'origine');
  assert.deepEqual(directives.get('object-src'), ["'none'"], 'object-src doit désactiver les plugins');
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"], 'frame-ancestors doit bloquer le cadrage');
  assert.deepEqual(directives.get('base-uri'), ["'self'"], 'base-uri doit empêcher le détournement de <base>');
  assert.deepEqual(directives.get('form-action'), ["'self'"], 'form-action doit être confiné à l\'origine');
  assert.deepEqual(directives.get('connect-src'), ["'self'"], 'connect-src doit rester fermé à l\'origine');
});

test("l'étape 1 est documentée comme telle (unsafe-inline assumé, étape 2 décrite)", () => {
  const value = cspValue();
  // Honnêteté de la portée : script-src n'est PAS strict aujourd'hui, et le
  // fichier doit dire pourquoi + ce qu'il reste à faire.
  assert.ok(value.includes("script-src 'self' 'unsafe-inline'"), 'script-src inattendu — mettre à jour le commentaire et ce test');
  assert.match(nginx, /ÉTAPE 2|ETAPE 2/, 'la suite (script-src strict) doit rester écrite dans le fichier');
  assert.match(nginx, /index\.html/, 'la justification de unsafe-inline doit nommer son origine (inline de index.html)');
});

test('les autres en-têtes de bord sont toujours là (pas de régression en ajoutant la CSP)', () => {
  for (const header of [
    'X-Frame-Options DENY',
    'X-Content-Type-Options nosniff',
    'Strict-Transport-Security',
    'Referrer-Policy strict-origin-when-cross-origin',
  ]) {
    assert.ok(nginx.includes(header), `en-tête perdu : ${header}`);
  }
});

test('les SPA ne publient aucun port en production (une seule CSP suffit)', () => {
  const compose = readFileSync('infrastructure/docker/docker-compose.prod.yml', 'utf8');
  for (const service of ['admin-web', 'support-console']) {
    const block = new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|^volumes:|$(?![\\s\\S]))`, 'm')
      .exec(compose);
    assert.ok(block, `service ${service} absent du compose de production`);
    assert.doesNotMatch(
      block[1],
      /^\s{4}ports:/m,
      `${service} publie un port en production : une CSP de bord ne le couvrirait plus, il faut aussi la mettre dans l'image`,
    );
  }
});

test('la CSP est valide pour nginx : aucun en-tête dupliqué dans les blocs location', () => {
  // add_header s'HÉRITE du bloc http, sauf si un bloc location en déclare un :
  // dans ce cas tous les en-têtes du parent sont remplacés (piège nginx
  // classique). On refuse donc tout add_header dans un location.
  const locations = nginx.split(/^\s{4}location /m).slice(1);
  for (const block of locations) {
    assert.doesNotMatch(
      block,
      /add_header/,
      'un add_header dans un bloc location supprimerait tous les en-têtes hérités (dont la CSP)',
    );
  }
});

test('le fichier de bord est bien rendu par envsubst au démarrage (et non copié tel quel)', () => {
  const compose = readFileSync('infrastructure/docker/docker-compose.prod.yml', 'utf8');
  assert.match(
    compose,
    /\.\.\/nginx\/nginx\.conf:\/etc\/nginx\/templates\/nginx\.conf\.template:ro/,
    'nginx.conf doit rester un template envsubst (${DOMAIN} en dépend)',
  );
  // Aucune substitution ${...} accidentelle dans la CSP (envsubst remplacerait
  // la valeur par du vide et la politique deviendrait invalide en silence).
  assert.doesNotMatch(cspValue(), /\$\{/, 'aucune variable à substituer ne doit apparaître dans la CSP');
});

test('la CSP survit au rendu envsubst du template', () => {
  // Le fichier est monté en /etc/nginx/templates/nginx.conf.template : le
  // point d'entrée nginx le rend par envsubst AVANT de charger la conf. Une
  // variable ${...} écrite par erreur dans la CSP disparaîtrait à cet instant
  // et la politique deviendrait invalide — sans aucun signal. Rendu simulé
  // ici en JS (déterministe, aucun binaire requis) avec les deux variables que
  // le compose fournit.
  const rendered = nginx
    .replaceAll('${DOMAIN}', 'creche.example.dz')
    .replaceAll('${SUPPORT_ALLOWED_CIDRS}', '');
  assert.equal(
    cspValue(),
    /^\s*add_header Content-Security-Policy "(.*)" always;$/m.exec(rendered)[1],
    'la CSP rendue diffère de la CSP écrite',
  );
  assert.match(rendered, /server_name creche\.example\.dz;/, 'le rendu DOMAIN doit fonctionner (sinon le test ne prouve rien)');
});

// NOTE (honnêteté) : `nginx -t` n'est PAS exécuté ici — ni nginx ni envsubst
// ne sont disponibles dans l'environnement de rédaction, et l'exiger rendrait
// ce test rouge pour des raisons d'environnement, pas de contenu. La
// validation syntaxique réelle appartient au job `docker` (images construites)
// et au runbook de déploiement.
