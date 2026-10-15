// E4 (harmonisation des fuseaux, 2026-10-15) — les `<input type="date">` de
// l'administration doivent s'ouvrir sur le JOUR CIVIL LOCAL, jamais sur le jour
// UTC (`toISOString().slice(0,10)`), qui décale d'un jour à Alger entre 00:00 et
// 01:00 et en fin de journée dans les fuseaux ouest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDateInputValue, localYear } from './dates.ts';

function withTz<T>(tz: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('00:30 à Alger = 31 octobre, pas le 30 (jour UTC)', () => {
  withTz('Africa/Algiers', () => {
    const instant = new Date('2026-10-30T23:30:00Z');
    assert.equal(localDateInputValue(instant), '2026-10-31');
    // Preuve du défaut corrigé : l'ancien rendu UTC donnait la veille.
    assert.equal(instant.toISOString().slice(0, 10), '2026-10-30');
  });
});

test('20:00 à Los Angeles = 1er novembre (et non le 31 octobre UTC)', () => {
  withTz('America/Los_Angeles', () => {
    const instant = new Date('2026-11-01T03:00:00Z');
    assert.equal(localDateInputValue(instant), '2026-10-31');
    assert.equal(instant.toISOString().slice(0, 10), '2026-11-01');
  });
});

test('le jour local est stable sur toute la journée', () => {
  withTz('Africa/Algiers', () => {
    for (const hour of [0, 7, 13, 23]) {
      assert.equal(localDateInputValue(new Date(2026, 9, 15, hour, 5)), '2026-10-15');
    }
  });
});

test('localYear suit le calendrier local, pas UTC', () => {
  withTz('Pacific/Kiritimati', () => {
    const instant = new Date('2026-12-31T23:30:00Z');
    assert.equal(localYear(instant), 2027); // 2027-01-01 01:30 à Kiritimati
    assert.equal(instant.getFullYear(), 2027);
  });
});
