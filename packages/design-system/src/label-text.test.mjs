/**
 * Garde-fou : le libellé rendu par TextField doit rester EXACTEMENT le texte
 * demandé, sans décoration ajoutée dans le DOM.
 *
 * Pourquoi ce test existe
 * -----------------------
 * Le nom d'un champ de formulaire est calculé en concaténant les nœuds de
 * texte descendants de son <label>. Ajouter une astérisque « obligatoire »
 * dans le DOM transforme « Prénom » en « Prénom * » et casse :
 *   - `getByLabel('Prénom', { exact: true })` (3 tests e2e en dépendent) ;
 *   - les lecteurs d'écran, qui annoncent « Prénom étoile » ;
 *   - tout outillage d'automatisation basé sur le libellé.
 *
 * Piège vérifié en conditions réelles : `aria-hidden="true"` ne suffit PAS.
 * L'implémentation de Playwright (`elementText` dans `coreBundle.js`) ignore
 * uniquement SCRIPT / NOSCRIPT / STYLE et le contenu de <head> — elle ne
 * filtre pas `aria-hidden`. Seule une astérisque générée en CSS (::after),
 * qui n'appartient pas au DOM, laisse le libellé intact.
 *
 * Ce test rejoue cet algorithme sur le HTML réellement produit par le
 * composant, plutôt que de faire confiance à une relecture du JSX.
 *
 * Exécution : `node --test src/label-text.test.mjs`
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

/*
  `components.tsx` contient du JSX : Node ne sait pas le charger nativement
  (`ERR_UNKNOWN_FILE_EXTENSION`). On le transpile à la volée avec esbuild —
  déjà présent (dépendance de Vite) — plutôt que d'ajouter un lanceur de
  tests ou une étape de build juste pour ce fichier.
*/
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'components.tsx'), 'utf8');
const { code } = transformSync(source, {
  loader: 'tsx',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
});
// Le module compilé est écrit à côté des sources : ses imports relatifs
// ('./tokens') et ses imports de paquets ('react/jsx-runtime') résolvent
// alors exactement comme en production.
const tmpDir = mkdtempSync(join(here, '.tmp-label-test-'));
const outFile = join(tmpDir, 'components.mjs');
writeFileSync(outFile, code.replace(/from ['"]\.\/([^'"]+)['"]/g, `from '${pathToFileURL(here).href}/$1.ts'`));
const { TextField } = await import(pathToFileURL(outFile).href);
// Le dossier temporaire vit dans src/ (pour que la résolution des imports
// soit identique à la production) : il faut donc le supprimer, sinon il
// pollue le dépôt à chaque exécution.
after(() => rmSync(tmpDir, { recursive: true, force: true }));

/**
 * Reproduit le calcul de Playwright : concaténation de tous les nœuds de
 * texte, sans aucun égard pour `aria-hidden`, `hidden` ou `display: none`.
 */
function labelTextAsPlaywrightSeesIt(html) {
  const match = html.match(/<label[^>]*>([\s\S]*?)<\/label>/);
  assert.ok(match, 'aucun <label> rendu');
  return match[1]
    .replace(/<[^>]+>/g, '') // retire le balisage, garde les nœuds de texte
    .replace(/\s+/g, ' ')
    .trim();
}

const render = (props) =>
  renderToStaticMarkup(
    React.createElement(TextField, { value: '', onChange: () => {}, ...props }),
  );

test('un champ obligatoire garde un libellé exact (pas d’astérisque dans le DOM)', () => {
  const html = render({ label: 'Prénom', required: true });
  assert.equal(
    labelTextAsPlaywrightSeesIt(html),
    'Prénom',
    "le libellé doit rester « Prénom » : l'astérisque doit être générée en CSS, jamais insérée dans le DOM",
  );
});

test('aucune astérisque littérale n’est rendue dans le balisage', () => {
  const html = render({ label: 'Mot de passe', required: true, type: 'password' });
  assert.ok(
    !html.includes('*'),
    'aucun caractère « * » ne doit apparaître dans le HTML rendu (il vient de ::after)',
  );
});

test('la classe qui porte l’astérisque CSS est appliquée si et seulement si required', () => {
  assert.match(render({ label: 'Nom', required: true }), /ds-field-required/);
  assert.doesNotMatch(render({ label: 'Nom' }), /ds-field-required/);
});

test('un champ facultatif garde lui aussi un libellé exact', () => {
  assert.equal(labelTextAsPlaywrightSeesIt(render({ label: 'Mois' })), 'Mois');
});

/**
 * Les libellés exacts attendus par les tests e2e (`getByLabel`).
 * Si l'un d'eux cesse de correspondre, la suite e2e échoue par timeout —
 * un mode d'échec opaque qu'on préfère attraper ici.
 */
test('les libellés utilisés par les tests e2e restent trouvables', () => {
  for (const label of ['Prénom', 'Nom', 'Mot de passe', 'Email', 'Mois', 'Année', 'Échéance']) {
    assert.equal(
      labelTextAsPlaywrightSeesIt(render({ label, required: true })),
      label,
      `getByLabel('${label}', { exact: true }) ne trouverait plus le champ`,
    );
  }
});
