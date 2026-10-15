import { businessDate, monthsBetweenDates, toCivilDay } from '@creche/prod-config';
import { AppError } from '../errors';

/**
 * Âge légal d'accueil en crèche (décret exécutif 19-253 du 28 août 2019,
 * portant création et organisation des crèches) : 3 mois à 3 ans révolus.
 *
 * Valeurs en mois : MIN = 3, MAX = 36.
 */
export const AGE_CRECHE_MIN_MONTHS = 3;
export const AGE_CRECHE_MAX_MONTHS = 36;

/**
 * Écart en mois entre `dob` et maintenant (partie entière, calendrier).
 *
 * E4 (harmonisation API, 2026-10-15) : la comparaison se fait sur des JOURS
 * CALENDAIRES, jamais sur des instants. `new Date('2024-01-01')` se parse en minuit
 * UTC puis se relit en heure locale : dans un fuseau ouest, le jour recule — un
 * enfant exactement à 3 ans ou à 3 mois était jugé sur le mauvais jour. `toCivilDay`
 * fige le jour de naissance, `businessDate` le jour du jour à Africa/Algiers.
 */
export function ageMonths(dob: string | Date, now: Date = new Date()): number {
  return monthsBetweenDates(toCivilDay(dob), businessDate(now));
}

/**
 * Refuse (409) la création d'un enfant hors de la tranche d'âge de la crèche.
 *
 * Rationale : le contrôle de conformité AGE_CRECHE
 * (compliance.service.ts:111) calculait l'écart mais le rétrogradait
 * systématiquement en `warning` — aucune saisie n'était jamais bloquée. Un
 * enfant de 5 ans pouvait être inscrit en crèche (établissement illégal).
 *
 * Décision : bloquer à la saisie (409) plutôt que d'importuner l'utilisatrice
 * avec un avertissement ignoré. Le décret est une condition d'agrément, pas
 * un conseil. L'administrateur plateforme (super_admin) reste libre via le
 * backoffice — l'API ne sert que les crèches.
 *
 * `dob` est déjà validée (classe-validator, @IsDateString) en amont ; un
 * format inattendu lève une erreur 400 générique.
 */
export function assertCrecheAge(dob: string | undefined | null): void {
  if (!dob) return; // la validation DTO gère le caractère requis
  const months = ageMonths(dob);
  if (months < AGE_CRECHE_MIN_MONTHS || months >= AGE_CRECHE_MAX_MONTHS) {
    throw new AppError(
      'AGE_CRECHE_OUT_OF_RANGE',
      `Une crèche accueille les enfants de 3 mois à 3 ans (décret 19-253) ; cet enfant a ${months} mois`,
      'تستقبل الحضانة الأطفال من 3 أشهر إلى 3 سنوات (مرسوم 19-253)؛ هذا الطفل عمره ' + months + ' شهرًا',
      409,
    );
  }
}

/** Jour de naissance strictement postérieur au jour courant (à Alger). */
export function isFutureBirthDate(dob: string | Date, now: Date = new Date()): boolean {
  return toCivilDay(dob) > businessDate(now);
}
