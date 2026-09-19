import { resolveDatabaseUrl } from './database.provider';

describe('resolveDatabaseUrl (D2 — jamais de repli silencieux en prod)', () => {
  test('DATABASE_URL fourni → utilisé tel quel', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://x@h/db', NODE_ENV: 'production' }))
      .toBe('postgres://x@h/db');
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://x@h/db' }))
      .toBe('postgres://x@h/db');
  });

  test('production sans DATABASE_URL → erreur fatale (pas de fallback dev)', () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production' }))
      .toThrow(/DATABASE_URL requis en production/);
  });

  test('hors production sans DATABASE_URL → repli dev historique', () => {
    expect(resolveDatabaseUrl({ NODE_ENV: 'test' })).toContain('creche_dev');
    expect(resolveDatabaseUrl({})).toContain('creche_dev');
  });
});
