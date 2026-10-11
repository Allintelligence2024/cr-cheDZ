import { isAlgerianPhone, normalizeAlgerianPhone } from './algerian-phone';

/**
 * H3 (dette MEDIUM/LOW, plan `PLAN_CORRECTION_AUDIT_2026-09.md` §H3) —
 * avant ce validateur, `@Matches(/^\+?[0-9]{8,15}$/)` (auth parent,
 * inscriptions) acceptait n'importe quel numéro international : `+1 555…`,
 * `+44 20…` passaient puis échouaient (ou pire) chez le fournisseur
 * SMS/WhatsApp. Les autres champs téléphone (tuteurs, personnel,
 * organisations, médecin) n'étaient validés nulle part.
 *
 * Ces tests fixent le contrat : mobiles 05/06/07, fixes 02/03/04, indicatif
 * +213 ou 00213, séparateurs tolérés, refus des formes étrangères et
 * mélangées (+2130…) — un 400 explicite vaut mieux qu'un envoi fantôme.
 */
describe('isAlgerianPhone', () => {
  it('accepte les mobiles au format national', () => {
    for (const phone of ['0550123456', '0661234567', '0770123456', '0550 12 34 56', '0550.12.34.56', '0550-12-34-56']) {
      expect(isAlgerianPhone(phone)).toBe(true);
    }
  });

  it('accepte les fixes au format national', () => {
    for (const phone of ['023123456', '021234567', '044123456']) {
      expect(isAlgerianPhone(phone)).toBe(true);
    }
  });

  it("accepte l'indicatif international +213 / 00213", () => {
    for (const phone of ['+213550123456', '+21323123456', '00213550123456', '+213 550 12 34 56']) {
      expect(isAlgerianPhone(phone)).toBe(true);
    }
  });

  it('normalise vers la forme nationale', () => {
    expect(normalizeAlgerianPhone('+213550123456')).toBe('0550123456');
    expect(normalizeAlgerianPhone('00213550123456')).toBe('0550123456');
    expect(normalizeAlgerianPhone('0550 12 34 56')).toBe('0550123456');
    expect(normalizeAlgerianPhone('+21323123456')).toBe('023123456');
    expect(normalizeAlgerianPhone('0500000000')).toBe('0500000000');
  });

  it('refuse les numéros étrangers', () => {
    for (const phone of ['+15550100000', '+442071838750', '+33612345678', '5551234567', '0100000000', '0800000000']) {
      expect(isAlgerianPhone(phone)).toBe(false);
    }
  });

  it('refuse la forme mélangée +2130… (zéro après indicatif)', () => {
    expect(isAlgerianPhone('+2130550123456')).toBe(false);
    expect(isAlgerianPhone('002130550123456')).toBe(false);
  });

  it('refuse les longueurs incorrectes et les non-numériques', () => {
    for (const phone of ['05501234', '05501234567', '055012345678', 'abc', '', '05501234ab', '0550 12 34 5']) {
      expect(isAlgerianPhone(phone)).toBe(false);
    }
  });

  it('refuse les non-chaînes', () => {
    for (const value of [null, undefined, 550123456, {}, ['0550123456']]) {
      expect(isAlgerianPhone(value)).toBe(false);
    }
  });
});
