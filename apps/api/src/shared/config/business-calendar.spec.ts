// E4 (harmonisation des fuseaux, 2026-10-15) — les calendriers métier ne doivent
// JAMAIS dépendre du fuseau du process : ni `toISOString().slice(0,10)` pour un
// `date` PostgreSQL (pg le construit en minuit LOCAL), ni `new Date('YYYY-MM-DD')`
// (minuit UTC) relu en heure locale pour une comparaison de jours.
//
// Jest épingle `TZ=UTC` dans son environnement : la sensibilité au fuseau est donc
// prouvée dans un PROCESSUS ENFANT dont on fixe `TZ` (même technique que la suite
// worker `phase28`, qui démarre le worker avec `TZ` et `PGOPTIONS`).
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { businessDate, businessDateTime, businessYear, localCalendarDay, monthsBetweenDates, shiftDateOnly, toCivilDay } from '@creche/prod-config';

// apps/api/src/shared/config → racine du monorepo
const repo = resolve(__dirname, '..', '..', '..', '..', '..');

/** Évalue un snippet dans un processus Node dont le fuseau est imposé. */
function runInTz(tz: string, expression: string): string {
  const script = `
    import { businessDate, businessDateTime, businessYear, localCalendarDay, monthsBetweenDates, shiftDateOnly, toCivilDay }
      from ${JSON.stringify(join(repo, 'packages/prod-config/src/calendar.ts'))};
    const parts = { businessDate, businessDateTime, businessYear, localCalendarDay, monthsBetweenDates, shiftDateOnly, toCivilDay };
    void parts;
    process.stdout.write(String(${expression}));
  `;
  return execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e', script], {
    cwd: repo,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
}

const POSITIVE_TZ = ['Africa/Algiers', 'Pacific/Kiritimati'];

describe('businessDate — jour civil du fuseau métier pour un INSTANT', () => {
  it('rend le jour d’Alger, pas le jour UTC (23:30 UTC → 31 à Alger)', () => {
    expect(businessDate(new Date('2026-10-30T23:30:00Z'))).toBe('2026-10-31');
    expect(businessDate(new Date('2026-10-31T00:30:00Z'))).toBe('2026-10-31');
    // Le jour UTC, lui, est bien la veille : c'est le défaut corrigé.
    expect(new Date('2026-10-30T23:30:00Z').toISOString().slice(0, 10)).toBe('2026-10-30');
  });

  it('ignore le fuseau du process (TZ positif comme négatif)', () => {
    for (const tz of ['America/Los_Angeles', ...POSITIVE_TZ, 'UTC']) {
      expect(runInTz(tz, `parts.businessDate(new Date('2026-10-30T23:30:00Z'))`)).toBe('2026-10-31');
    }
  });

  it('refuse un instant non datable', () => {
    expect(() => businessDate('pas-une-date')).toThrow('INSTANT_INVALID');
    expect(() => businessDateTime('pas-une-date')).toThrow('INSTANT_INVALID');
  });

  it('businessDateTime — horodatage du document, heure d’Alger et non UTC', () => {
    // L’en-tête « Générée le … » d’une facture rendue à 23:30 UTC porte déjà
    // l’heure du lendemain à Alger : c’est le jour que la famille voit à
    // l’écran, donc le jour que le document doit porter.
    expect(businessDateTime(new Date('2026-10-30T23:30:00Z'))).toBe('2026-10-31 00:30');
    expect(runInTz('America/Los_Angeles', `parts.businessDateTime(new Date('2026-10-30T23:30:00Z'))`)).toBe('2026-10-31 00:30');
    expect(runInTz('Africa/Algiers', `parts.businessDateTime(new Date('2026-10-30T23:30:00Z'))`)).toBe('2026-10-31 00:30');
  });

  it('businessYear : une saisie du 31/12 23:30 UTC est déjà de l’année suivante à Alger', () => {
    expect(businessYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
    expect(new Date('2026-12-31T23:30:00Z').getFullYear()).toBe(2026);
  });
});

describe('localCalendarDay — relecture d’une colonne `date` rendue par pg', () => {
  it('dans un fuseau en avance sur UTC, l’ancien `toISOString()` reculait d’un jour', () => {
    for (const tz of POSITIVE_TZ) {
      // `postgres-date` construit un `date` en minuit LOCAL : sous TZ=+01:00,
      // ce même instant relu en UTC est la veille. `localCalendarDay` rend le
      // jour stocké ; c'est exactement ce qui faisait rejeter une administration
      // de médicament parfaitement à date (MEDICATION_OUTSIDE_AUTH).
      const naive = runInTz(tz, `new Date(2026, 9, 31).toISOString().slice(0, 10)`);
      expect(naive).toBe('2026-10-30');
      expect(runInTz(tz, `parts.localCalendarDay(new Date(2026, 9, 31))`)).toBe('2026-10-31');
    }
  });

  it('accepte la chaîne ISO déjà normalisée (cast ::text, chemin du worker)', () => {
    expect(localCalendarDay('2024-02-29')).toBe('2024-02-29');
    expect(() => localCalendarDay('2026-02-30')).toThrow('DATE_ONLY_INVALID');
  });

  it('une chaîne horodatée est lue dans le fuseau métier', () => {
    expect(localCalendarDay('2026-10-30T23:30:00Z')).toBe('2026-10-31');
  });
});

describe('toCivilDay — jour d’une saisie (chaîne), sans conversion', () => {
  it('AAAA-MM-JJ est repris tel quel, quel que soit le fuseau du process', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', ...POSITIVE_TZ]) {
      expect(runInTz(tz, `parts.toCivilDay('2024-01-01')`)).toBe('2024-01-01');
    }
    // L'ancien chemin (parse UTC puis composants locaux) décalait le jour à
    // l'ouest de UTC — c'est ce que la validation d'import ne doit plus faire.
    const naive = "(() => { const d = new Date('2024-01-01');"
      + " return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()";
    expect(runInTz('America/Los_Angeles', naive)).toBe('2023-12-31');
  });

  it('un format horodaté reste daté à Alger', () => {
    expect(toCivilDay('2024-01-01T00:00:00Z')).toBe('2024-01-01');
  });
});

describe('monthsBetweenDates / shiftDateOnly — arithmétique de calendrier pur', () => {
  it('anniversaire du mois : la veille = N-1 mois, le jour même = N mois', () => {
    expect(monthsBetweenDates('2024-01-15', '2024-04-14')).toBe(2);
    expect(monthsBetweenDates('2024-01-15', '2024-04-15')).toBe(3);
    expect(monthsBetweenDates('2023-01-31', '2026-01-30')).toBe(35);
    expect(monthsBetweenDates('2023-01-31', '2026-01-31')).toBe(36);
  });

  it('bornes légales du décret 19-253 (3 mois, 3 ans)', () => {
    expect(monthsBetweenDates('2026-01-01', '2026-04-01')).toBe(3);
    expect(monthsBetweenDates('2026-01-01', '2026-03-31')).toBe(2);
    expect(monthsBetweenDates('2023-01-01', '2026-01-01')).toBe(36);
  });

  it('traverse les années bissextiles sans dérive', () => {
    expect(shiftDateOnly('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDateOnly('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftDateOnly('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateOnly('2026-10-15', -30)).toBe('2026-09-15');
  });

  it('aucun de ces calculs ne dépend du fuseau du process', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', ...POSITIVE_TZ]) {
      expect(runInTz(tz, `parts.shiftDateOnly('2026-10-15', -30)`)).toBe('2026-09-15');
      expect(runInTz(tz, `parts.monthsBetweenDates('2024-02-29', '2025-02-28')`)).toBe('11');
    }
  });
});
