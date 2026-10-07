import { JOURNAL_EVENT_TYPES } from './dto/journal.dto';

/**
 * 3.2.5 (remédiation 2026-10-04) — `GET /journal/events` acceptait
 * `event_type` via un cast `(query as {event_type?: string}).event_type`
 * sans aucune validation : une valeur inconnue était injectée telle quelle
 * dans le SQL. La correction l'a ajouté au DTO `JournalListQuery` avec
 * `@IsIn(JOURNAL_EVENT_TYPES)` — rejet 400 propre.
 *
 * Ce test fixe la liste : un nouveau type d'événement métier ajouté à la base
 * doit être déclaré ici, sinon le filtre le refuse (silencieusement).
 */

describe('JournalListQuery.event_type (3.2.5)', () => {
  it('accepte les types métier connus', () => {
    expect(JOURNAL_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'meal', 'nap_start', 'nap_end', 'diaper', 'activity',
        'temperature', 'note', 'health_observation', 'incident',
      ]),
    );
  });

  it('refuse un type inconnu', () => {
    expect(JOURNAL_EVENT_TYPES).not.toContain('unknown');
    expect(JOURNAL_EVENT_TYPES).not.toContain('sleep');
    expect(JOURNAL_EVENT_TYPES).not.toContain('');
  });

  it('ne contient pas de doublon (sinon le @IsIn reste vrai par accident)', () => {
    expect(new Set(JOURNAL_EVENT_TYPES).size).toBe(JOURNAL_EVENT_TYPES.length);
  });
});
