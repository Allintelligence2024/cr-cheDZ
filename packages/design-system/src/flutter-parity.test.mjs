/**
 * Garde-fou : le thème Flutter doit rester le miroir exact de `theme.css`.
 *
 * Les applications mobiles ne peuvent pas importer le CSS : les couleurs
 * Sérénité y sont recopiées en Dart (`apps/*\/lib/theme/serenite_theme.dart`).
 * Sans test, une correction de palette faite côté web partirait en silence
 * du mobile — exactement le genre de dérive qui ne se voit qu'en production.
 *
 * Ce test compare les deux sources caractère par caractère et vérifie en plus
 * que les deux applis Flutter partagent bien le même fichier.
 *
 * Exécution : `node --test src/flutter-parity.test.mjs`
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const cssPath = resolve(here, 'theme.css');
const dartPaths = [
  resolve(repoRoot, 'apps/staff-mobile/lib/theme/serenite_theme.dart'),
  resolve(repoRoot, 'apps/parent-mobile/lib/theme/serenite_theme.dart'),
];

const css = readFileSync(cssPath, 'utf8');
const dart = readFileSync(dartPaths[0], 'utf8');

/** Extrait les `--c-*: #RRGGBB` d'un bloc de sélecteur CSS. */
function cssBlock(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `Sélecteur introuvable dans theme.css : ${selector}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) {
    out.set(m[1], m[2].toUpperCase());
  }
  return out;
}

/** Extrait les `static const Color x = Color(0xFFRRGGBB)` d'une classe Dart. */
function dartBlock(className) {
  const start = dart.indexOf(`abstract final class ${className}`);
  assert.notEqual(start, -1, `Classe Dart introuvable : ${className}`);
  const end = dart.indexOf('\n}', start);
  const body = dart.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/Color (\w+) = Color\(0xFF([0-9A-Fa-f]{6})\)/g)) {
    out.set(m[1], `#${m[2].toUpperCase()}`);
  }
  return out;
}

/** Correspondance nom Dart ↔ nom de variable CSS (sans le préfixe `c-`). */
const MAPPING = [
  ['primary', 'primary'],
  ['primaryHover', 'primary-hover'],
  ['primaryActive', 'primary-active'],
  ['primaryContrast', 'primary-contrast'],
  ['primarySoft', 'primary-soft'],
  ['primaryBorder', 'primary-border'],
  ['background', 'background'],
  ['surface', 'surface'],
  ['surfaceAlt', 'surface-alt'],
  ['surfaceHover', 'surface-hover'],
  ['text', 'text'],
  ['textMuted', 'text-muted'],
  ['textFaint', 'text-faint'],
  ['border', 'border'],
  ['borderStrong', 'border-strong'],
  ['success', 'success'],
  ['successBg', 'success-bg'],
  ['onSuccess', 'success-contrast'],
  ['warning', 'warning'],
  ['warningBg', 'warning-bg'],
  ['onWarning', 'warning-contrast'],
  ['danger', 'danger'],
  ['dangerBg', 'danger-bg'],
  ['onDanger', 'danger-contrast'],
  ['info', 'info'],
  ['infoBg', 'info-bg'],
  ['onInfo', 'info-contrast'],
];

test('thème clair : Dart == CSS', () => {
  const cssVars = cssBlock(':root {');
  const dartVars = dartBlock('SereniteLight');
  for (const [dartName, cssName] of MAPPING) {
    assert.equal(
      dartVars.get(dartName),
      cssVars.get(`c-${cssName}`),
      `SereniteLight.${dartName} doit valoir --c-${cssName}`,
    );
  }
});

test('thème sombre : Dart == CSS', () => {
  const cssVars = cssBlock(":root[data-theme='dark'] {");
  const dartVars = dartBlock('SereniteDark');
  for (const [dartName, cssName] of MAPPING) {
    assert.equal(
      dartVars.get(dartName),
      cssVars.get(`c-${cssName}`),
      `SereniteDark.${dartName} doit valoir --c-${cssName}`,
    );
  }
});

test('les deux applis Flutter partagent le même thème', () => {
  const [staff, parent] = dartPaths.map((p) => readFileSync(p, 'utf8'));
  assert.equal(
    staff,
    parent,
    'apps/staff-mobile et apps/parent-mobile doivent avoir un serenite_theme.dart identique',
  );
});
