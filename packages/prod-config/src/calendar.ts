/** Politique calendrier : DATE = chaîne ISO sans fuseau ; instants = timestamptz.
 * Les horaires métier s'interprètent dans Africa/Algiers (jamais TZ du process).
 *
 * Garde E4 (harmonisation API, 2026-10-15) : `new Date(« YYYY-MM-DD »)` se parse en
 * minuit UTC et `date.toLocaleDateString`/`toISOString` dépendent du fuseau du
 * process. Un jour calendaire lu ou rendu ainsi change de valeur selon le TZ de la
 * machine (Algiers UTC+1, Los Angeles UTC-8) : toutes les lectures métier passent
 * donc par les fonctions ci-dessous, jamais par `Date` directement.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Algiers';

export function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw new Error('DATE_ONLY_INVALID');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('DATE_ONLY_INVALID');
  return value;
}

/** Date civile (AAAA-MM-JJ) du fuseau métier pour un INSTANT (timestamptz, `NOW()`),
 *  jamais les composants locaux du process : `new Date().toISOString().slice(0,10)`
 *  renvoie la veille entre 00:00 et 01:00 à Alger (UTC+1) et le lendemain dans un
 *  fuseau ouest. */
export function businessDate(now: Date | string | number = new Date()): string {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('INSTANT_INVALID');
  // `en-CA` produit exactement AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(instant);
}

/** Jour civil d'une colonne `date` telle que node-postgres la rend. L'analyse par
 *  `postgres-date` construit un `Date` en MINUIT LOCAL du fuseau du process ; relire
 *  les composants locaux est l'inverse exact de ce parsing, quel que soit ce fuseau.
 *  Reconvertir en UTC (`toISOString()`) reculerait le jour dès que le serveur est en
 *  avance sur UTC — c'est ce qui faisait échouer une saisie parfaitement à date.
 *  Une chaîne est acceptée telle quelle (worker : OID 1082 rendu en texte). */
export function localCalendarDay(value: unknown): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('DATE_ONLY_INVALID');
    const iso = `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    return dateOnly(iso);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dateOnly(text);
  // Instant rendu en chaîne (timestamptz) : son jour civil métier, pas son jour UTC.
  const instant = new Date(text);
  if (!Number.isFinite(instant.getTime())) throw new Error('DATE_ONLY_INVALID');
  return businessDate(instant);
}

/** Horodatage lisible (AAAA-MM-JJ HH:MM) dans le fuseau métier — pour les mentions
 *  « Générée le … » des documents livrés aux familles ; jamais l'heure UTC du process. */
export function businessDateTime(now: Date | string | number = new Date()): string {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('INSTANT_INVALID');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

/** Année calendaire du fuseau métier — préfixe des références (CR-, IMP-, PRE-,
 *  ATT-) : une saisie du 31 décembre 23:30 UTC est déjà le 1er janvier à Alger. */
export function businessYear(now: Date = new Date()): number {
  return Number(businessDate(now).slice(0, 4));
}

/** Décale une date civile de `days` jours, sans heure ni fuseau (UTC = repère de
 *  calcul uniquement ; le résultat est un jour calendaire). */
/** Jour civil d'une SAISIE (chaîne) — distinct de `localCalendarDay` (valeur `date`
 *  rendue par PostgreSQL). Une date ISO explicite est reprise telle quelle, sans
 *  conversion ; tout autre format repasse par l'instant qu'il désigne, lu à Alger.
 *  Un objet `Date` vient de PostgreSQL : composants locaux (voir `localCalendarDay`). */
export function toCivilDay(value: unknown): string {
  if (value instanceof Date) return localCalendarDay(value);
  const text = String(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return dateOnly(text);
  return businessDate(new Date(text));
}

export function shiftDateOnly(value: string, days: number): string {
  const iso = dateOnly(value);
  if (!Number.isInteger(days)) throw new Error('SHIFT_DAYS_INVALID');
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mois révolus entre deux dates civiles (AAAA-MM-JJ) — calendrier pur, aucune
 *  dépendance au fuseau du process (contrairement à `new Date(str)` qui se lit en
 *  minuit LOCAL et décale le jour hors UTC). */
export function monthsBetweenDates(from: string, to: string): number {
  const f = dateOnly(from).split('-').map(Number);
  const t = dateOnly(to).split('-').map(Number);
  let months = ((t[0] as number) - (f[0] as number)) * 12 + ((t[1] as number) - (f[1] as number));
  if ((t[2] as number) < (f[2] as number)) months -= 1; // anniversaire du mois pas encore passé
  return months;
}

export function monthBounds(year: number, month: number): [string, string] {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('MONTH_INVALID');
  }
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  // Date.UTC traite 0–99 comme 1900–1999 : construire une date ISO d'abord.
  const endDate = new Date(`${first}T00:00:00Z`);
  endDate.setUTCMonth(month, 0);
  const end = endDate.toISOString().slice(0, 10);
  return [first, end];
}

export function exportRange(reportType: string, period: string): [string, string] {
  if (reportType === 'invoices') {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('EXPORT_PERIOD_INVALID');
    const [year, month] = period.split('-').map(Number);
    monthBounds(year!, month!);
    return [String(year), String(month)];
  }
  if (reportType !== 'attendance') throw new Error('EXPORT_TYPE_INVALID');
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-').map(Number);
    return monthBounds(year!, month!);
  }
  const parts = period.split('..');
  if (parts.length > 2) throw new Error('EXPORT_PERIOD_INVALID');
  const start = dateOnly(parts[0]); const end = dateOnly(parts[1] ?? parts[0]);
  if (start > end) throw new Error('EXPORT_PERIOD_INVALID');
  return [start, end];
}
