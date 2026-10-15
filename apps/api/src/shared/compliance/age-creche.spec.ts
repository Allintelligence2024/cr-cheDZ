// E4 (harmonisation des fuseaux, 2026-10-15) — la tranche d'âge du décret 19-253
// est une règle DE CALENDRIER, pas un calcul d'instants. Avant correction,
// `new Date('YYYY-MM-DD')` (minuit UTC) était relu en heure locale par le contrôle
// d'import : le jour de naissance — donc la borne légale — changeait selon le
// fuseau du serveur. `ageMonths` compose désormais `toCivilDay` (saisie) et
// `businessDate` (jour du jour à Alger), tous deux indépendants du fuseau.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AGE_CRECHE_MAX_MONTHS, AGE_CRECHE_MIN_MONTHS, ageMonths, assertCrecheAge, isFutureBirthDate } from './age-creche';
import { businessDate, monthsBetweenDates, toCivilDay } from '@creche/prod-config';
import { AppError } from '../errors';

const repo = resolve(__dirname, '..', '..', '..', '..', '..');
const CALENDAR_MODULE = JSON.stringify(resolve(repo, 'packages/prod-config/src/calendar.ts'));
const ZONES = ['UTC', 'Africa/Algiers', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo'];

/** Évalue une expression de calendrier dans un processus Node au fuseau imposé. */
function runInTz(tz: string, expression: string): string {
  const script = `
    import { businessDate, monthsBetweenDates, toCivilDay } from ${CALENDAR_MODULE};
    const parts = { businessDate, monthsBetweenDates, toCivilDay };
    void parts;
    process.stdout.write(String(${expression}));
  `;
  return execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e', script], {
    cwd: repo,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

describe('ageMonths — calendrier pur, indépendant du fuseau du serveur', () => {
  it('3 ans révolus : la borne ne bouge pas d\u2019un fuseau à l\u2019autre', () => {
    for (const tz of ZONES) {
      const onBirthday = Number(runInTz(tz, `parts.monthsBetweenDates('2023-01-31', '2026-01-31')`));
      const dayBefore = Number(runInTz(tz, `parts.monthsBetweenDates('2023-01-31', '2026-01-30')`));
      expect(onBirthday).toBe(AGE_CRECHE_MAX_MONTHS);
      expect(dayBefore).toBe(35);
      // En process, la règle compose exactement ces deux lectures.
      expect(ageMonths('2023-01-31', new Date('2026-01-31T08:00:00Z'))).toBe(onBirthday);
      expect(ageMonths('2023-01-31', new Date('2026-01-30T08:00:00Z'))).toBe(dayBefore);
    }
  });

  it('3 mois : même borne quelle que soit la zone', () => {
    for (const tz of ZONES) {
      expect(Number(runInTz(tz, `parts.monthsBetweenDates('2026-01-01', '2026-04-01')`))).toBe(AGE_CRECHE_MIN_MONTHS);
      expect(Number(runInTz(tz, `parts.monthsBetweenDates('2026-01-01', '2026-03-31')`))).toBe(2);
    }
  });

  it('la saisie n\u2019est jamais reconvertie par un Date (jour préservé)', () => {
    for (const tz of ZONES) {
      expect(runInTz(tz, `parts.toCivilDay('2024-01-01')`)).toBe('2024-01-01');
    }
    expect(toCivilDay('2024-01-01')).toBe('2024-01-01');
  });

  it('le mois de naissance non encore échu compte un mois de moins', () => {
    expect(ageMonths('2024-05-31', new Date('2024-08-30T12:00:00Z'))).toBe(2);
    expect(ageMonths('2024-05-31', new Date('2024-08-31T12:00:00Z'))).toBe(3);
  });

  it('ageMonths = toCivilDay + businessDate (contrat de la correction)', () => {
    const now = new Date('2026-10-15T23:30:00Z'); // 2026-10-16 à Alger
    expect(ageMonths('2026-07-16', now)).toBe(monthsBetweenDates(toCivilDay('2026-07-16'), businessDate(now)));
    expect(businessDate(now)).toBe('2026-10-16');
  });
});

describe('assertCrecheAge / isFutureBirthDate', () => {
  it('accepte la borne basse (3 mois) et refuse la veille', () => {
    const today = businessDate(); // le « aujourd'hui » du contrôle
    expect(() => assertCrecheAge(shiftMonths(today, -3))).not.toThrow();
    expect(() => assertCrecheAge(shiftMonths(today, -2))).toThrow(AppError);
  });

  it('refuse 3 ans révolus et un enfant de 5 ans', () => {
    const today = businessDate();
    expect(() => assertCrecheAge(shiftMonths(today, -36))).toThrow(/3 ans/);
    expect(() => assertCrecheAge(shiftMonths(today, -60))).toThrow(/60 mois/);
  });

  it('une naissance du jour n\u2019est jamais « dans le futur », quel que soit le fuseau', () => {
    for (const tz of ['Africa/Algiers', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      const todayHere = runInTz(tz, 'parts.businessDate()');
      expect(isFutureBirthDate(todayHere, new Date())).toBe(false);
    }
    expect(isFutureBirthDate('2099-01-01')).toBe(true);
  });

  it('sans date renseignée, le contrôle reste délégué au DTO', () => {
    expect(() => assertCrecheAge(null)).not.toThrow();
    expect(() => assertCrecheAge(undefined)).not.toThrow();
  });
});

/** Recule une date civile de `months` mois en gardant un jour valide. */
function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC((y as number) - Math.floor(-months / 12) * 0, (m as number) - 1 + months, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(d as number, lastDay));
  return shifted.toISOString().slice(0, 10);
}
