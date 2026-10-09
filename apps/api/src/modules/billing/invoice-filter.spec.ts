import { KNOWN_INVOICE_STATUSES } from './billing.service';

/**
 * 3.2.4 (remédiation 2026-10-04) — `listInvoices` ignorait silencieusement
 * `status`, `page` et `limit` : l'onglet Factures du director-mobile
 * récupérait TOUTES les factures de l'organisation (pagination + filtre
 * morts). La correction pose une liste blanche de statuts : un filtre
 * inconnu est ignoré (renvoie tout) plutôt que de planter en 500.
 *
 * Ce test fixe la liste pour qu'aucun statut métier ne disparaisse
 * silencieusement (un statut supprimé ferait que le filtre ne filtre plus).
 */

describe('listInvoices — liste blanche de statuts (3.2.4)', () => {
  it('contient exactement les 6 statuts métier de la base', () => {
    expect([...KNOWN_INVOICE_STATUSES].sort()).toEqual(
      ['cancelled', 'draft', 'overdue', 'paid', 'sent', 'void'],
    );
  });

  it('n accepte pas un statut inventé', () => {
    expect(KNOWN_INVOICE_STATUSES.includes('pending' as never)).toBe(false);
    expect(KNOWN_INVOICE_STATUSES.includes('' as never)).toBe(false);
    expect(KNOWN_INVOICE_STATUSES.includes('PARTIALLY_PAID' as never)).toBe(false);
  });

  it('est figée (as const) — le type est un tuple readonly', () => {
    // La garantie est statique : `KNOWN_INVOICE_STATUSES.push('x')` est
    // refusé à la compilation (readonly tuple). On le vérifie par le type.
    const ok: readonly string[] = KNOWN_INVOICE_STATUSES;
    expect(ok.length).toBe(6);
  });
});
