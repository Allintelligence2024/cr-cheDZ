/**
 * Q7 — rendu des chaînes traduites de l'administration (voir lib/interpolate.ts).
 * Exécuté par node --test (`npm run test:unit --workspace @creche/admin-web`).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolate } from './interpolate.ts';

test('le jeton {n} est meublé, pas affiché tel quel', () => {
  assert.equal(interpolate('{n} enfant(s) importé(s)', { n: 3 }), '3 enfant(s) importé(s)');
});

test('les nombres, 0 et la chaîne vide sont des valeurs valides', () => {
  assert.equal(interpolate('Reste {n}', { n: 0 }), 'Reste 0');
  assert.equal(interpolate('{a}–{b}', { a: '', b: 'x' }), '–x');
  assert.equal(interpolate('Total {n} DA', { n: 1250.5 }), 'Total 1250.5 DA');
});

test('un jeton sans valeur reste affiché (aucune suppression silencieuse)', () => {
  assert.equal(interpolate('{present} et {missing}', { present: 'ok' }), 'ok et {missing}');
});

test('sans paramètres, la chaîne est rendue à l’identique', () => {
  assert.equal(interpolate('Aucun jeton ici'), 'Aucun jeton ici');
  assert.equal(interpolate('Des {accolades} non demandées', {}), 'Des {accolades} non demandées');
});

test('un jeton répété est meublé partout', () => {
  assert.equal(interpolate('{d} — {d}', { d: '12' }), '12 — 12');
});

test('les caractères $ d’une valeur ne sont pas réinterprétés', () => {
  // `String.replace(re, string)` interprète `$&`, `$1`, `$'` dans la valeur ;
  // l'implémentation passe par une fonction pour neutraliser ce piège — une
  // facture dont la référence vaudrait « 100$& » casserait le libellé entier.
  assert.equal(interpolate('Réf. {ref}', { ref: 'F$&2026' }), 'Réf. F$&2026');
  assert.equal(interpolate('{a}/{b}', { a: "$'", b: '$1' }), "$'/$1");
});

test('les jetons se limitent aux mots ASCII (les mentions monétaires ne sont pas des jetons)', () => {
  assert.equal(interpolate('Payé {1 200} DA', { '1 200': 'x' }), 'Payé {1 200} DA');
});
