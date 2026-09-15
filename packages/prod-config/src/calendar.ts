/** Politique calendrier : DATE = chaîne ISO sans fuseau ; instants = timestamptz.
 * Les horaires métier s'interprètent dans Africa/Algiers (jamais TZ du process).
 */
export const BUSINESS_TIME_ZONE = 'Africa/Algiers';

export function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw new Error('DATE_ONLY_INVALID');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('DATE_ONLY_INVALID');
  return value;
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
