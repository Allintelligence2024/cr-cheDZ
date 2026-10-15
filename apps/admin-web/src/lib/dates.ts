/**
 * Dates calendaires côté navigateur (E4 — harmonisation des fuseaux).
 *
 * `new Date().toISOString().slice(0, 10)` rend le jour **UTC**, pas le jour de
 * l'utilisatrice : à Alger (UTC+1) entre 00:00 et 01:00, le sélecteur de date
 * s'ouvrait sur la veille ; dans un fuseau ouest en fin de journée, sur le
 * lendemain. Les champs `type="date"` attendent un jour civil LOCAL — ils
 * passent donc par ces helpers, jamais par `toISOString()`.
 */

/** Jour civil local au format AAAA-MM-JJ (attendu par `<input type="date">`). */
export function localDateInputValue(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA').format(now);
}

/** Année civile locale — préfixe d'affichage des références saisies à l'écran. */
export function localYear(now: Date = new Date()): number {
  return now.getFullYear();
}
