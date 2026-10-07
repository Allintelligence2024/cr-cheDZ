import { registerDecorator, isDateString, type ValidationArguments, type ValidationOptions } from 'class-validator';

/**
 * Validation stricte des dates ISO (audit 2026-10-02, phase80).
 *
 * `@IsDateString()` s'appuie sur `isISO8601` sans mode strict : « 2026-02-31 »,
 * « 2026-04-31 » ou « 2025-02-29 » passent la validation alors que le jour
 * n'existe pas. Ces valeurs atteignaient ensuite PostgreSQL (cast `::date`,
 * colonne `date`/`timestamptz`) qui les rejetait en 22008 — donc un
 * **500 INTERNAL_ERROR** au lieu d'un 400 pour une simple entrée invalide.
 *
 * Ce décorateur conserve exactement la sémantique d'`@IsDateString()` (mêmes
 * formats acceptés, y compris les horodatages ISO avec fuseau) et rejette en
 * plus les dates dont le jour n'existe pas dans le calendrier.
 */
function hasValidCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return true; // format non `AAAA-MM-JJ` : délégué à isDateString
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  // `Date.UTC(y, month, 0)` = dernier jour du mois `month` (1-indexé).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/** `@IsDateString()` + existence réelle du jour dans le calendrier. */
export function isStrictIsoDate(value: unknown): boolean {
  return typeof value === 'string' && isDateString(value) && hasValidCalendarDate(value);
}

// Même signature que `@IsDateString(options, validationOptions)` de
// class-validator : le premier argument (options de format) est conservé pour
// la parité d'appel, seul le second porte les options de validation.
export function IsStrictIsoDate(_options?: unknown, validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isStrictIsoDate',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean => isStrictIsoDate(value),
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} doit être une date ISO valide (ex. 2026-01-31)`,
      },
    });
  };
}
