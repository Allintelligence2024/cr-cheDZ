import { buildReceiptNumber, receiptSalt } from './receipt';

/**
 * B4 (audit 2026-09-19) : le numéro de reçu ne contient plus de fragment
 * d'UUID tenant en clair — sel court = SHA-256 tronqué à 8 hexadécimaux.
 */
describe('billing receipts (B4)', () => {
  const orgA = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const orgB = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

  it('receiptSalt : 8 hexadécimaux, stable, distinct par tenant, sans fragment d’UUID', () => {
    expect(receiptSalt(orgA)).toMatch(/^[0-9a-f]{8}$/);
    expect(receiptSalt(orgA)).toBe(receiptSalt(orgA));
    expect(receiptSalt(orgA)).not.toBe(receiptSalt(orgB));
    expect(receiptSalt(orgA)).not.toBe(orgA.slice(0, 8));
  });

  it('buildReceiptNumber : REC-<séquence>-<sel tenant>', () => {
    expect(buildReceiptNumber(42, orgA)).toBe(`REC-42-${receiptSalt(orgA)}`);
    expect(buildReceiptNumber(42, orgA)).toMatch(/^REC-\d+-[0-9a-f]{8}$/);
  });
});
