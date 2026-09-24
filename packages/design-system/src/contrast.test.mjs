/**
 * Garde-fou accessibilité — contraste WCAG des deux thèmes.
 *
 * Lit directement `theme.css` (source de vérité) et vérifie que chaque paire
 * texte/fond réellement utilisée dans l'interface atteint son seuil.
 * Un futur ajustement de palette qui casserait la lisibilité échoue ici.
 *
 * Lancer :  node --test packages/design-system/src/contrast.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'theme.css'), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Extrait le corps d'un bloc CSS en équilibrant les accolades. */
function block(selector) {
  const start = stripped.indexOf(selector);
  assert.ok(start !== -1, `sélecteur introuvable : ${selector}`);
  const open = stripped.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < stripped.length; i += 1) {
    if (stripped[i] === '{') depth += 1;
    else if (stripped[i] === '}') {
      depth -= 1;
      if (depth === 0) return stripped.slice(open + 1, i);
    }
  }
  throw new Error(`bloc non terminé : ${selector}`);
}

function varsOf(selector) {
  const out = {};
  for (const m of block(selector).matchAll(/(--c-[a-z-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Paires réellement rendues à l'écran. [premier plan, fond, seuil]
   4.5 = AA texte normal · 3.0 = AA texte large / éléments non textuels. */
const PAIRS = [
  ['--c-text', '--c-background', 4.5],
  ['--c-text', '--c-surface', 4.5],
  ['--c-text', '--c-surface-alt', 4.5],
  ['--c-text-muted', '--c-surface', 4.5],
  ['--c-text-muted', '--c-background', 4.5],
  ['--c-text-muted', '--c-surface-alt', 4.5],
  ['--c-primary', '--c-surface', 4.5],
  ['--c-primary', '--c-primary-soft', 4.5],
  ['--c-primary-contrast', '--c-primary', 4.5],
  ['--c-danger', '--c-surface', 4.5],
  ['--c-danger', '--c-danger-bg', 4.5],
  ['--c-success', '--c-surface', 4.5],
  ['--c-success', '--c-success-bg', 4.5],
  ['--c-warning', '--c-surface', 4.5],
  ['--c-warning', '--c-warning-bg', 4.5],
  ['--c-info', '--c-surface', 4.5],
  ['--c-info', '--c-info-bg', 4.5],
  ['--c-sidebar-text', '--c-sidebar', 4.5],
  ['--c-sidebar-muted', '--c-sidebar', 3.0],
  ['--c-text-faint', '--c-surface', 3.0],
];

const THEMES = {
  clair: varsOf(':root'),
  sombre: varsOf(":root[data-theme='dark']"),
};

for (const [name, palette] of Object.entries(THEMES)) {
  test(`thème ${name} — contraste WCAG AA`, () => {
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(palette[fg], `${fg} absent du thème ${name}`);
      assert.ok(palette[bg], `${bg} absent du thème ${name}`);
      const r = contrast(palette[fg], palette[bg]);
      assert.ok(
        r >= min,
        `${name} : ${fg} sur ${bg} = ${r.toFixed(2)}:1, minimum ${min}:1`,
      );
    }
  });
}

test('les deux thèmes définissent exactement les mêmes variables', () => {
  const light = Object.keys(THEMES.clair).sort();
  const dark = Object.keys(THEMES.sombre).sort();
  const missing = light.filter((k) => !dark.includes(k));
  assert.deepEqual(missing, [], `variables absentes du thème sombre : ${missing.join(', ')}`);
});

test('la préférence système reprend la palette sombre', () => {
  // Sans ce bloc, un utilisateur en sombre voit un flash clair avant React.
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /:root:not\(\[data-theme='light'\]\):not\(\[data-theme='dark'\]\)/);
});
