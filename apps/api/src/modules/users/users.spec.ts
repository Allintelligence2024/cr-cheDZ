/**
 * Tests unitaires — UsersService (4.2, couverture hors-plan).
 *
 * La logique critique de ce service est SÉCURITAIRE, pas accidentelle :
 *   - `addRoleAssignment` est un chemin d'escalade de privilèges potentiel
 *     (finding C2 de l'audit) : un directeur pourrait s'octroyer super_admin.
 *   - `assertRoleAssignable` est la garde centralisée — un oubli dans un
 *     module voisin a déjà créé le trou.
 *
 * Ces tests fixent le contrat de sécurité : pool et contexte tenant MOCKÉS,
 * on vérifie chaque garde AVANT la moindre écriture en base.
 */
import { randomUUID } from 'node:crypto';

interface QueryCall { sql: string; params: unknown[] }

describe('UsersService.addRoleAssignment (garde C2)', () => {
  const ORG = randomUUID();
  const ACTOR = randomUUID();
  const TARGET_USER = randomUUID();
  const ROLE_EDUC = randomUUID();
  const ROLE_SUPER = randomUUID();

  let clientQueries: QueryCall[];
  let service: import('./users.service').UsersService;

  const setup = async (overrides: {
    membershipRole?: string;
    roleSlug?: string | null;
    roleRowMissing?: boolean;
  } = {}) => {
    const { UsersService } = await import('./users.service');
    clientQueries = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        clientQueries.push({ sql: compact, params });
        if (compact.startsWith('SELECT role_id FROM memberships')) {
          return { rows: [{ role_id: overrides.membershipRole ?? ROLE_EDUC }], rowCount: 1 };
        }
        if (compact.startsWith('SELECT slug FROM roles')) {
          if (overrides.roleRowMissing) return { rows: [], rowCount: 0 };
          return { rows: [{ slug: overrides.roleSlug ?? 'educator' }], rowCount: 1 };
        }
        if (compact.startsWith('INSERT INTO role_assignments')) {
          return { rows: [{ id: randomUUID(), user_id: TARGET_USER, role_id: ROLE_EDUC, created_at: new Date() }], rowCount: 1 };
        }
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const audit = {
      log: async () => undefined,
    } as unknown as import('../privacy/audit.service').AuditService;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    service = new UsersService(tenantContext, audit, pool);
  };

  test('utilisateur non membre du tenant → 404 (pas de fuite d existence)', async () => {
    await setup();
    // on force le premier SELECT à vide via une 2e instance
    const { UsersService } = await import('./users.service');
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT role_id FROM memberships')) return { rows: [], rowCount: 0 };
        throw new Error('ne devrait pas aller plus loin : ' + compact.slice(0, 60));
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const audit = { log: async () => undefined } as unknown as import('../privacy/audit.service').AuditService;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    const svc = new UsersService(tenantContext, audit, pool);

    await expect(
      svc.addRoleAssignment(ACTOR, ORG, { user_id: TARGET_USER, role_id: ROLE_EDUC }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('rôle inconnu ou d une autre organisation → 400 ROLE_NOT_FOUND', async () => {
    await setup({ roleRowMissing: true });
    await expect(
      service.addRoleAssignment(ACTOR, ORG, { user_id: TARGET_USER, role_id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND', status: 400 });

    // AUCUNE écriture ne doit avoir lieu sur un rôle inconnu.
    expect(clientQueries.find((q) => q.sql.startsWith('INSERT INTO role_assignments'))).toBeUndefined();
  });

  test('super_admin JAMAIS attribuable → 403 ROLE_FORBIDDEN', async () => {
    await setup({ roleSlug: 'super_admin' });
    await expect(
      service.addRoleAssignment(ACTOR, ORG, { user_id: TARGET_USER, role_id: ROLE_SUPER }),
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN', status: 403 });

    // Le garde s exécute AVANT l INSERT : aucune ligne écrite.
    expect(clientQueries.find((q) => q.sql.startsWith('INSERT INTO role_assignments'))).toBeUndefined();
  });

  test('rôle déjà principal → 409 ROLE_ALREADY_PRIMARY', async () => {
    await setup({ membershipRole: ROLE_EDUC, roleSlug: 'educator' });
    await expect(
      service.addRoleAssignment(ACTOR, ORG, { user_id: TARGET_USER, role_id: ROLE_EDUC }),
    ).rejects.toMatchObject({ code: 'ROLE_ALREADY_PRIMARY', status: 409 });
  });

  test('chemin nominal : INSERT + audit journalisé', async () => {
    let auditLogged = false;
    const { UsersService } = await import('./users.service');
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT role_id FROM memberships')) return { rows: [{ role_id: randomUUID() }], rowCount: 1 };
        if (compact.startsWith('SELECT slug FROM roles')) return { rows: [{ slug: 'educator' }], rowCount: 1 };
        if (compact.startsWith('INSERT INTO role_assignments')) return { rows: [{ id: randomUUID() }], rowCount: 1 };
        throw new Error('SQL inattendue : ' + compact.slice(0, 60));
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const audit = {
      log: async (entry: { action: string; resourceType: string }) => {
        auditLogged = true;
        expect(entry.action).toBe('update');
        expect(entry.resourceType).toBe('role_assignment');
      },
    } as unknown as import('../privacy/audit.service').AuditService;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    const svc = new UsersService(tenantContext, audit, pool);

    const res = await svc.addRoleAssignment(ACTOR, ORG, { user_id: TARGET_USER, role_id: ROLE_EDUC });
    expect(res).toBeDefined();
    expect(auditLogged).toBe(true);
  });
});

describe('UsersService.removeRoleAssignment', () => {
  const ORG = randomUUID();
  const ACTOR = randomUUID();

  test('assignment introuvable → 404 (le DELETE RLS filtre les autres tenants)', async () => {
    const { UsersService } = await import('./users.service');
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('DELETE FROM role_assignments')) return { rows: [], rowCount: 0 };
        throw new Error('SQL inattendue : ' + compact.slice(0, 60));
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const audit = { log: async () => undefined } as unknown as import('../privacy/audit.service').AuditService;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    const svc = new UsersService(tenantContext, audit, pool);

    await expect(svc.removeRoleAssignment(ORG, randomUUID(), ACTOR)).rejects.toMatchObject({ status: 404 });
  });
});
