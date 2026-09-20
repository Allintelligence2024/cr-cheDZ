/**
 * G4 — révocabilité globale : contrat de comparaison d'époque (P1-4).
 * Tout relâchement ici = un principal révoqué qui continue d'agir.
 */
import type { Pool } from 'pg';
import { AppError } from '../errors';
import { principalEpochMatches, readPrincipalEpoch, unauthorizedRevokedPrincipal } from './principal-epoch';

function poolWith(handler: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }> | never): Pool {
  return { query: jest.fn(handler) } as unknown as Pool;
}

describe('principalEpochMatches — fail-closed', () => {
  it('claim absent (rolling deploy) vaut 0 : accepté seulement si l’époque courante est 0', () => {
    expect(principalEpochMatches(undefined, 0)).toBe(true);
    expect(principalEpochMatches(null, 0)).toBe(true);
    expect(principalEpochMatches(undefined, 1)).toBe(false);
  });
  it('égalité stricte : 3 vs 3 ok ; 2 vs 3 (révoqué) refusé ; 4 vs 3 (forgé en avance) refusé', () => {
    expect(principalEpochMatches(3, 3)).toBe(true);
    expect(principalEpochMatches(2, 3)).toBe(false);
    expect(principalEpochMatches(4, 3)).toBe(false);
  });
  it('compte disparu (null) ou époque non finie → refus', () => {
    expect(principalEpochMatches(0, null)).toBe(false);
    expect(principalEpochMatches(0, Number.NaN)).toBe(false);
    expect(principalEpochMatches(0, Number.POSITIVE_INFINITY)).toBe(false);
  });
  it('claims malformés (négatif, décimal, chaîne non numérique, objet, > safe int) → refus', () => {
    expect(principalEpochMatches(-1, -1)).toBe(false);
    expect(principalEpochMatches(1.5, 1.5)).toBe(false);
    expect(principalEpochMatches('abc', 0)).toBe(false);
    expect(principalEpochMatches({}, 0)).toBe(false);
    expect(principalEpochMatches(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
  it('claim numérique sous forme de chaîne ("2") est toléré s’il vaut exactement l’époque', () => {
    expect(principalEpochMatches('2', 2)).toBe(true);
    expect(principalEpochMatches('2', 3)).toBe(false);
  });
});

describe('readPrincipalEpoch', () => {
  it('sub invalide (non-chaîne / vide) → null sans toucher la base', async () => {
    const pool = poolWith(async () => ({ rows: [] }));
    expect(await readPrincipalEpoch(pool, undefined)).toBeNull();
    expect(await readPrincipalEpoch(pool, '')).toBeNull();
    expect(await readPrincipalEpoch(pool, 42)).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('chemin nominal : auth_principal_epoch (SECURITY DEFINER) → nombre', async () => {
    const pool = poolWith(async (text) => {
      expect(text).toMatch(/auth_principal_epoch\(\$1\)/);
      return { rows: [{ auth_principal_epoch: '7' }] };
    });
    expect(await readPrincipalEpoch(pool, 'u1')).toBe(7);
  });

  it('fonction répond NULL (compte supprimé) ou aucune ligne → null', async () => {
    expect(await readPrincipalEpoch(poolWith(async () => ({ rows: [{ auth_principal_epoch: null }] })), 'u1')).toBeNull();
    expect(await readPrincipalEpoch(poolWith(async () => ({ rows: [] })), 'u1')).toBeNull();
  });

  it('42883 (fonction absente : migration 062 pas encore appliquée) → repli colonne users, hors soft-deleted', async () => {
    const seen: string[] = [];
    const pool = poolWith(async (text) => {
      seen.push(text);
      if (/auth_principal_epoch/.test(text)) throw Object.assign(new Error('function does not exist'), { code: '42883' });
      expect(text).toMatch(/FROM users WHERE id = \$1 AND deleted_at IS NULL/);
      return { rows: [{ token_epoch: 2 }] };
    });
    expect(await readPrincipalEpoch(pool, 'u1')).toBe(2);
    expect(seen).toHaveLength(2);
  });

  it('toute autre erreur SQL est propagée (jamais transformée en « accès accordé »)', async () => {
    const pool = poolWith(async () => { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); });
    await expect(readPrincipalEpoch(pool, 'u1')).rejects.toThrow('connection refused');
  });
});

describe('unauthorizedRevokedPrincipal', () => {
  it('lève UNAUTHORIZED 401 générique (aucune fuite compte-vs-époque)', () => {
    let caught: unknown;
    try { unauthorizedRevokedPrincipal(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('UNAUTHORIZED');
    expect((caught as AppError).status).toBe(401);
  });
});
