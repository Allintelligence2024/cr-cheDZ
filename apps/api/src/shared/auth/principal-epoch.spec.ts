import { principalEpochMatches } from './principal-epoch';

/**
 * G4 (audit 2026-09) : sémantique pure de la comparaison d'époque du
 * principal. La révocabilité HTTP/PG complète est prouvée par la suite
 * phase53 ; ce fichier verrouille les cas limites du helper utilisé par les
 * deux gardes, sans base de données.
 */
describe('principalEpochMatches (G4)', () => {
  it('accepte le claim égal à l\'époque courante', () => {
    expect(principalEpochMatches(3, 3)).toBe(true);
  });
  it('traite un token sans claim epoch comme époque 0 (rolling deploy)', () => {
    expect(principalEpochMatches(undefined, 0)).toBe(true);
    expect(principalEpochMatches(null, 0)).toBe(true);
  });
  it('refuse dès que l\'époque courante dépasse le claim (révocation)', () => {
    expect(principalEpochMatches(undefined, 1)).toBe(false);
    expect(principalEpochMatches(2, 3)).toBe(false);
  });
  it('refuse un principal disparu ou illisible (époque null) — fail-closed', () => {
    expect(principalEpochMatches(0, null)).toBe(false);
    expect(principalEpochMatches(7, null)).toBe(false);
  });
  it('rejette des claims non sûrs ou mal formés plutôt que de les convertir', () => {
    expect(principalEpochMatches('x', 0)).toBe(false);
    expect(principalEpochMatches(-1, 0)).toBe(false);
    expect(principalEpochMatches(1.5, 1.5)).toBe(false);
    expect(principalEpochMatches(2 ** 53, 2 ** 53)).toBe(false);
    // bigint renvoyé en chaîne par pg : valeur sûre acceptée
    expect(principalEpochMatches('4', 4)).toBe(true);
  });
  it('refuse une époque courante non finie (corruption/dérive) — fail-closed', () => {
    expect(principalEpochMatches(0, Number.NaN)).toBe(false);
    expect(principalEpochMatches(0, Infinity)).toBe(false);
  });
});
