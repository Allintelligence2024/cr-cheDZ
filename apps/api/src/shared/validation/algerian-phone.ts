import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator';

/**
 * Validation des numéros de téléphone algériens (dette H3 — marché cible).
 *
 * Avant : `@Matches(/^\+?[0-9]{8,15}$/)` (auth parent, inscriptions) — un
 * `+1 555 010 999` ou un `+44 20 7183 8750` passaient la validation puis
 * partaient chez le fournisseur SMS/WhatsApp, qui les rejetait (ou pire, les
 * acceptait pour un autre pays). Aucune validation du tout sur les autres
 * champs téléphone (tuteurs, personnel, organisations, médecin).
 *
 * Formats acceptés (indicatif international `+213`/`00213` ou préfixe
 * national `0`, séparateurs espaces/points/tirets ignorés) :
 *   - mobile  : `0[5-7] XX XX XX XX`  (ex. 0550 12 34 56, +213550123456)
 *   - fixe    : `0[2-4] XX XX XX XX`  (ex. 023 12 34 56,  +213231234567)
 *
 * Forme mélangée (`+2130550123456`, zéro APRÈS l'indicatif) refusée : c'est
 * l'erreur de saisie la plus fréquente, mieux vaut un 400 explicite qu'une
 * valeur stockée que personne ne peut rappeler.
 */

/** Espaces, points, tirets et parenthèses : séparateurs tolérés à la saisie. */
const SEPARATORS = /[\s.()-]/g;

/** Mobile `0[5-7]` + 8 chiffres, fixe `0[2-4]` + 7 chiffres. */
function isValidNationalNumber(national: string): boolean {
  return /^0[567]\d{8}$/.test(national) || /^0[234]\d{7}$/.test(national);
}

/**
 * Normalise vers la forme nationale `0XXXXXXXXX` (mobile) / `0XXXXXXXX`
 * (fixe), ou retourne `null` si le numéro n'est pas algérien.
 */
export function normalizeAlgerianPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(SEPARATORS, '');
  let national: string;
  const international = /^(?:\+?213|00213)(\d+)$/.exec(compact);
  if (international) {
    // +213/00213 : le zéro national est omis → on le rétablit.
    national = `0${international[1]}`;
  } else if (/^0\d+$/.test(compact)) {
    national = compact;
  } else {
    return null;
  }
  return isValidNationalNumber(national) ? national : null;
}

export function isAlgerianPhone(value: unknown): boolean {
  return normalizeAlgerianPhone(value) !== null;
}

export function IsAlgerianPhone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isAlgerianPhone',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean => isAlgerianPhone(value),
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} doit être un numéro algérien valide (ex. 0550 12 34 56 ou +213550123456)`,
      },
    });
  };
}
