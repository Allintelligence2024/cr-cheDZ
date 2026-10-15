/**
 * Interpolation des jetons `{nom}` des chaînes traduites.
 *
 * Extraite de `i18n.tsx` (module `.tsx`, donc hors de portée du runner
 * `node --test` de l'administration) pour que le comportement — et non
 * seulement la présence des clés, déjà couverte par
 * `scripts/check-i18n-parity.mjs` — soit testé. Le défaut réparé en
 * `fix(i18n)` (commit 3b95a9a) était précisément un `{n}` affiché tel quel :
 * le garde statique le voit dans le catalogue, ce module le voit au rendu.
 */

/**
 * Remplace les jetons `{nom}` par la valeur fournie. Un jeton sans valeur
 * correspondante reste affiché tel quel (un libellé partiellement meublé vaut
 * mieux qu'un trou), et `0`/`''` sont des valeurs comme les autres.
 */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
  );
}
