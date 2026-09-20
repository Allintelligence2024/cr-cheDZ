/**
 * TenantContextService — contrat de sûreté RLS (P1-4, couverture mesurée).
 *
 * Ce service est LE point de passage de toute requête tenant : si son
 * comportement dérive (set_config oublié, COMMIT sur erreur, client non
 * rendu au pool), la RLS devient une passoire ou le pool s'épuise. Ces tests
 * fixent le contrat, indépendamment de PostgreSQL (client `pg` simulé).
 */
import type { Pool, PoolClient } from 'pg';
import { requestContextStorage } from '../context/request-context';
import { TenantContextService } from './tenant-context.service';

interface FakeClient extends Pick<PoolClient, 'query' | 'release'> {
  calls: Array<{ text: string; values?: unknown[] }>;
  released: number;
}

function fakePool(behaviour: { failOn?: string } = {}): { pool: Pool; client: FakeClient } {
  const client: FakeClient = {
    calls: [],
    released: 0,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      client.calls.push({ text, values });
      if (behaviour.failOn && text === behaviour.failOn) throw new Error(`boom ${text}`);
      return { rows: [], rowCount: 0 } as never;
    }) as never,
    release: jest.fn(() => { client.released += 1; }) as never,
  };
  const pool = { connect: jest.fn(async () => client) } as unknown as Pool;
  return { pool, client };
}

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const inContext = <T>(fn: () => Promise<T>): Promise<T> => requestContextStorage.run({ tenantId: null, userId: null, correlationId: null }, fn);

describe('TenantContextService', () => {
  describe('contexte de requête', () => {
    it('setContext hors requête → erreur explicite (middleware manquant)', () => {
      const svc = new TenantContextService(fakePool().pool);
      expect(() => svc.setContext(TENANT, USER)).toThrow(/Contexte de requête absent/);
    });

    it('getTenantId sans tenant posé → erreur ; OrNull → null ; getUserId → null', async () => {
      const svc = new TenantContextService(fakePool().pool);
      await inContext(async () => {
        expect(svc.getTenantIdOrNull()).toBeNull();
        expect(svc.getUserId()).toBeNull();
        expect(() => svc.getTenantId()).toThrow(/non initialisé/);
      });
    });

    it('setContext puis lectures cohérentes, isolées par requête', async () => {
      const svc = new TenantContextService(fakePool().pool);
      await inContext(async () => {
        svc.setContext(TENANT, USER);
        expect(svc.getTenantId()).toBe(TENANT);
        expect(svc.getUserId()).toBe(USER);
      });
      // Une autre requête ne voit rien de la précédente.
      await inContext(async () => expect(svc.getTenantIdOrNull()).toBeNull());
    });
  });

  describe('withTenantConnection — contrat RLS', () => {
    it('BEGIN → set_config tenant + user (transaction-locales) → callback → COMMIT → release', async () => {
      const { pool, client } = fakePool();
      const svc = new TenantContextService(pool);
      const out = await inContext(async () => {
        svc.setContext(TENANT, USER);
        return svc.withTenantConnection(async (c) => { await c.query('SELECT 1'); return 'ok'; });
      });
      expect(out).toBe('ok');
      expect(client.calls.map((c) => c.text)).toEqual([
        'BEGIN',
        'SELECT set_config($1, $2, true)',
        'SELECT set_config($1, $2, true)',
        'SELECT 1',
        'COMMIT',
      ]);
      expect(client.calls[1].values).toEqual(['app.tenant_id', TENANT]);
      expect(client.calls[2].values).toEqual(['app.user_id', USER]);
      expect(client.released).toBe(1);
    });

    it('sans tenant posé : AUCUN set_config (RLS fail-closed → 0 ligne), la transaction reste valide', async () => {
      const { pool, client } = fakePool();
      const svc = new TenantContextService(pool);
      await inContext(() => svc.withTenantConnection(async () => undefined));
      expect(client.calls.map((c) => c.text)).toEqual(['BEGIN', 'COMMIT']);
      expect(client.calls.some((c) => c.values?.includes('app.tenant_id'))).toBe(false);
    });

    it('hors de tout contexte de requête (worker/CLI) : pas de set_config non plus', async () => {
      const { pool, client } = fakePool();
      await new TenantContextService(pool).withTenantConnection(async () => undefined);
      expect(client.calls.map((c) => c.text)).toEqual(['BEGIN', 'COMMIT']);
    });

    it('erreur du callback → ROLLBACK (jamais COMMIT), erreur propagée, client rendu', async () => {
      const { pool, client } = fakePool();
      const svc = new TenantContextService(pool);
      await expect(inContext(async () => {
        svc.setContext(TENANT, USER);
        return svc.withTenantConnection(async () => { throw new Error('métier'); });
      })).rejects.toThrow('métier');
      const texts = client.calls.map((c) => c.text);
      expect(texts).toContain('ROLLBACK');
      expect(texts).not.toContain('COMMIT');
      expect(client.released).toBe(1);
    });

    it('échec du COMMIT lui-même → ROLLBACK tenté, erreur d’origine propagée, client rendu', async () => {
      const { pool, client } = fakePool({ failOn: 'COMMIT' });
      await expect(new TenantContextService(pool).withTenantConnection(async () => 1)).rejects.toThrow('boom COMMIT');
      expect(client.calls.map((c) => c.text)).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
      expect(client.released).toBe(1);
    });

    it('échec du ROLLBACK après une erreur → l’erreur MÉTIER reste celle propagée (pas masquée)', async () => {
      const { pool, client } = fakePool({ failOn: 'ROLLBACK' });
      const svc = new TenantContextService(pool);
      await expect(svc.withTenantConnection(async () => { throw new Error('métier'); })).rejects.toThrow('métier');
      expect(client.released).toBe(1);
    });
  });
});
