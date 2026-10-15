import { utcDayInstant } from '@creche/prod-config';

/** H2d — public parent financial read models. Fixed SQL aliases i/p/c only.
 * Shared by list and detail so adding a database column never publishes it.
 * These projections do NOT authorize access: current guardian capability checks
 * and tenant RLS remain mandatory in ParentsService.
 */
export const PARENT_INVOICE_FIELDS_SQL = `
  i.id, i.child_id, i.invoice_number, i.period_year, i.period_month,
  i.subtotal, i.discount_amount, i.total_amount, i.paid_amount, i.balance,
  i.status, i.due_date, i.sent_at, i.created_at, i.updated_at,
  (NULLIF(i.pdf_url, '') IS NOT NULL) AS pdf_ready,
  c.first_name_fr AS child_first_name, c.last_name_fr AS child_last_name`;

export const PARENT_RECEIPT_FIELDS_SQL = `
  p.id, p.child_id, p.reference_number, p.receipt_number, p.amount, p.currency,
  p.method, p.status, p.received_at, p.confirmed_at, p.created_at,
  c.first_name_fr AS child_first_name, c.last_name_fr AS child_last_name`;

/** Ligne facture telle que la rend le portail parent. Seule `due_date` (colonne
 *  `date`) est matérialisée ici : livrée telle quelle, c'est `Date.prototype.toJSON`
 *  qui parle, donc le jour dépend du fuseau de la machine hôte — la veille à Alger
 *  comme à Tokyo. `utcDayInstant` rend les mêmes octets qu'aujourd'hui (le conteneur
 *  est à `TZ=UTC`) mais ne dépend plus de l'hôte, y compris sur une VM sans Docker.
 *  Les clés du contrat public H2d sont inchangées (`exactKeys`, phase38). */
export function parentInvoiceWireRow<T extends Record<string, unknown>>(row: T): T {
  if (row.due_date === undefined || row.due_date === null) return row;
  return { ...row, due_date: utcDayInstant(row.due_date) };
}
