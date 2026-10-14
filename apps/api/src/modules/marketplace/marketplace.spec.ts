/**
 * Tests unitaires — MarketplaceService (4.2, couverture hors-plan).
 *
 * L'enjeu de ce service est la DIVULGATION : l'endpoint est PUBLIC (pas de
 * JWT), donc aucune donnée sensible ne doit fuiter. Deux gardes :
 *   1. `isEnabled()` — flag GLOBAL marketplace désactivé → `list()` renvoie
 *      [] SANS LIRE la table organizations (fail-closed) ;
 *   2. la requête ne projette QUE des champs de présentation
 *      (`settings->>'public_listing' = 'true'`) — pas d'emails internes,
 *      pas de données d'enfants.
 *
 * On mocke le contexte tenant et on capture le SQL émis.
 */
interface QueryCall { sql: string; params: unknown[] }

describe('MarketplaceService', () => {
  let clientQueries: QueryCall[];
  let service: import('./marketplace.service').MarketplaceService;

  const setup = async (featureEnabled: boolean) => {
    const { MarketplaceService } = await import('./marketplace.service');
    clientQueries = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        clientQueries.push({ sql: compact, params });
        if (compact.startsWith('SELECT is_enabled FROM feature_flags')) {
          return { rows: [{ is_enabled: featureEnabled }], rowCount: 1 };
        }
        if (compact.startsWith('SELECT slug, name_fr')) {
          return { rows: [{ slug: 'creche-a', public_name: 'Crèche A' }], rowCount: 1 };
        }
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    service = new MarketplaceService(tenantContext);
  };

  test('flag marketplace OFF → list() renvoie [] ET ne lit jamais organizations', async () => {
    await setup(false);
    const rows = await service.list();
    expect(rows).toEqual([]);

    // Le garde fail-closed : on interroge feature_flags, jamais organizations.
    const orgQuery = clientQueries.find((q) => q.sql.includes('FROM organizations'));
    expect(orgQuery).toBeUndefined();
  });

  test('flag marketplace OFF → isEnabled() renvoie false', async () => {
    await setup(false);
    expect(await service.isEnabled()).toBe(false);
  });

  test('flag marketplace ON → isEnabled() renvoie true', async () => {
    await setup(true);
    expect(await service.isEnabled()).toBe(true);
  });

  test('flag ON → la requête ne projette QUE des champs de présentation', async () => {
    await setup(true);
    const rows = await service.list();
    expect(rows).toHaveLength(1);

    const orgQuery = clientQueries.find((q) => q.sql.includes('FROM organizations'));
    expect(orgQuery).toBeDefined();
    // opt-in explicite requis : un listing public n'est jamais implicite.
    expect(orgQuery!.sql).toContain("settings->>'public_listing' = 'true'");
    expect(orgQuery!.sql).toContain('is_active = true');
    // pas de fuite : aucune colonne interne, aucun enfant.
    const forbidden = ['child', 'invoice', 'payment', 'internal_email', 'users'];
    for (const term of forbidden) {
      expect(orgQuery!.sql.toLowerCase()).not.toContain(term);
    }
    // champs publics attendus.
    expect(orgQuery!.sql).toContain('public_name');
    expect(orgQuery!.sql).toContain('public_phone');
    expect(orgQuery!.sql).toContain('public_email');
    expect(orgQuery!.sql).toContain('public_description');
  });

  test('flag désactivé et table vide → isEnabled() renvoie false (pas de crash)', async () => {
    const { MarketplaceService } = await import('./marketplace.service');
    const client = {
      query: async (sql: string) => {
        if (sql.replace(/\s+/g, ' ').trim().startsWith('SELECT is_enabled FROM feature_flags')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error('SQL inattendue');
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const svc = new MarketplaceService(tenantContext);
    expect(await svc.isEnabled()).toBe(false);
    expect(await svc.list()).toEqual([]);
  });
});
