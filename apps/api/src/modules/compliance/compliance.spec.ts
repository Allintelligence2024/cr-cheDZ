/**
 * Tests unitaires — ComplianceService (4.2, couverture hors-plan).
 *
 * Ce service encode le DÉCRET EXÉCUTIF 19-253 (2019) — ce ne sont pas des
 * règles métier optionnelles :
 *   - CAP_150 : capacité maximale par établissement (150 par défaut) ;
 *   - RATIO_EDUC : ≥ 2 éducateurs qualifiés par groupe, ≤ 10 enfants par
 *     éducateur ;
 *   - AGE_CRECHE : enfants de 3 mois à 3 ans en crèche ;
 *   - DOC_STAFF : une salle avec enfants sans personnel qualifié = fail ;
 *   - PRICE_DISPLAY : tarifs affichés si enfants accueillis (art. 16).
 *
 * `assertCapacity` est le garde ENFORCÉ à la création d'enfant (409)
 * — un contournement laisserait dépasser la capacité légale.
 */
import { randomUUID } from 'node:crypto';

describe('ComplianceService.assertCapacity (garde 409)', () => {
  const ORG = randomUUID();

  const mk = async (overrides: { maxChildren?: number; activeChildren?: number } = {}) => {
    const { ComplianceService } = await import('./compliance.service');
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT max_children FROM organizations')) {
          return { rows: [{ max_children: overrides.maxChildren ?? 10 }], rowCount: 1 };
        }
        if (compact.startsWith('SELECT COUNT(*)::int AS n FROM children')) {
          return { rows: [{ n: overrides.activeChildren ?? 5 }], rowCount: 1 };
        }
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    } as unknown as import('pg').PoolClient;
    const tenantContext = {
      withTenantConnection: async () => [],
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    return { svc: new ComplianceService(tenantContext), client };
  };

  test('sous la capacité → pas de rejet', async () => {
    const { svc, client } = await mk({ maxChildren: 10, activeChildren: 5 });
    await expect(svc.assertCapacity(client, ORG, 1)).resolves.toBeUndefined();
  });

  test('à la capacité exacte + 1 enfant → 409 CAPACITY_EXCEEDED', async () => {
    const { svc, client } = await mk({ maxChildren: 10, activeChildren: 10 });
    await expect(svc.assertCapacity(client, ORG, 1)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED', status: 409,
    });
  });

  test('import en masse qui dépasse → 409 (additional > 1)', async () => {
    const { svc, client } = await mk({ maxChildren: 10, activeChildren: 8 });
    await expect(svc.assertCapacity(client, ORG, 5)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED', status: 409,
    });
  });

  test('la capacité s applique AUX ENFANTS ACTIFS (deleted_at filtré)', async () => {
    // Le mock compte 5 enfants actifs ; deleted_at IS NULL est dans le SQL.
    const { svc, client } = await mk({ maxChildren: 6, activeChildren: 5 });
    await expect(svc.assertCapacity(client, ORG, 1)).resolves.toBeUndefined();
  });

  test('organisation sans max_children → défaut légal 150', async () => {
    const { ComplianceService } = await import('./compliance.service');
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT max_children FROM organizations')) return { rows: [{}], rowCount: 1 };
        if (compact.startsWith('SELECT COUNT(*)')) return { rows: [{ n: 149 }], rowCount: 1 };
        throw new Error('SQL inattendue : ' + compact.slice(0, 60));
      },
    } as unknown as import('pg').PoolClient;
    const tenantContext = {
      withTenantConnection: async () => [],
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const svc = new ComplianceService(tenantContext);
    await expect(svc.assertCapacity(client, ORG, 1)).resolves.toBeUndefined();
    await expect(svc.assertCapacity(client, ORG, 5)).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
  });
});

describe('ComplianceService.runChecks (règles 19-253)', () => {
  const ORG = randomUUID();
  let executed: Array<{ sql: string; params: unknown[] }>;

  const mk = async (overrides: {
    children?: number;
    rooms?: Array<{ id: string; name_fr: string; max_capacity: number; children_count: number }>;
    educatorsByRoom?: Record<string, number>;
    activeContracts?: number;
    establishmentType?: string;
  } = {}) => {
    const { ComplianceService } = await import('./compliance.service');
    executed = [];
    const childrenRows = Array.from({ length: overrides.children ?? 5 }, () => ({ id: randomUUID(), date_of_birth: '2025-01-01', room_id: randomUUID(), age_days: 400 }));
    const rooms = overrides.rooms ?? [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        executed.push({ sql: compact, params });
        if (compact.startsWith('SELECT cr.id, cr.code')) {
          return { rows: [
            { id: randomUUID(), code: 'CAP_150', severity: 'critical', message_fr: 'Capacité', message_ar: 'السعة' },
            { id: randomUUID(), code: 'RATIO_EDUC', severity: 'critical', message_fr: 'Ratio', message_ar: 'النسبة' },
            { id: randomUUID(), code: 'AGE_CRECHE', severity: 'warning', message_fr: 'Âge', message_ar: 'العمر' },
            { id: randomUUID(), code: 'DOC_STAFF', severity: 'critical', message_fr: 'Personnel', message_ar: 'الموظفون' },
            { id: randomUUID(), code: 'PRICE_DISPLAY', severity: 'warning', message_fr: 'Tarifs', message_ar: 'الأسعار' },
          ], rowCount: 5 };
        }
        if (compact.startsWith('SELECT id, name_fr, max_children, establishment_type FROM organizations')) {
          return { rows: [{ id: ORG, name_fr: 'Crèche', max_children: 10, establishment_type: overrides.establishmentType ?? 'creche' }], rowCount: 1 };
        }
        if (compact.startsWith('SELECT c.id, c.date_of_birth')) return { rows: childrenRows, rowCount: childrenRows.length };
        if (compact.startsWith('SELECT r.id, r.name_fr, r.max_capacity, COUNT')) return { rows: rooms, rowCount: rooms.length };
        if (compact.startsWith('SELECT sa.room_id, COUNT')) {
          return { rows: Object.entries(overrides.educatorsByRoom ?? {}).map(([room_id, educator_count]) => ({ room_id, educator_count })), rowCount: 0 };
        }
        if (compact.startsWith('SELECT COUNT(*)::int AS n FROM contracts')) return { rows: [{ n: overrides.activeContracts ?? 1 }], rowCount: 1 };
        if (compact.startsWith('INSERT INTO compliance_checks')) return { rows: [], rowCount: 1 };
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    return new ComplianceService(tenantContext);
  };

  const resultsByCode = (results: Array<Record<string, unknown>>) => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const r of results) {
      const code = r.code as string;
      (map.get(code) ?? map.set(code, []).get(code)!).push(r);
    }
    return map;
  };

  test('CAP_150 : sous le seuil → pass', async () => {
    const svc = await mk({ children: 3 });
    const { results } = await svc.runChecks();
    const cap = resultsByCode(results).get('CAP_150')!;
    expect(cap).toHaveLength(1);
    expect(cap[0].result).toBe('pass');
  });

  test('CAP_150 : au-delà de 90% → warning (seuil d alerte)', async () => {
    const svc = await mk({ children: 9 }); // 9 sur max 10 → 90%
    const { results } = await svc.runChecks();
    const cap = resultsByCode(results).get('CAP_150')!;
    expect(cap[0].result).toBe('warning');
  });

  test('CAP_150 : capacité dépassée → fail', async () => {
    const svc = await mk({ children: 11 }); // > max_children 10
    const { results } = await svc.runChecks();
    const cap = resultsByCode(results).get('CAP_150')!;
    expect(cap[0].result).toBe('fail');
  });

  test('RATIO_EDUC : 2 éducateurs pour 25 enfants → fail (> 10/éducateur)', async () => {
    const roomId = randomUUID();
    const svc = await mk({ children: 25, rooms: [{ id: roomId, name_fr: 'Salle A', max_capacity: 30, children_count: 25 }], educatorsByRoom: { [roomId]: 2 } });
    const { results } = await svc.runChecks();
    const ratio = resultsByCode(results).get('RATIO_EDUC')!;
    expect(ratio[0].result).toBe('fail');
  });

  test('RATIO_EDUC : 2 éducateurs pour 20 enfants → pass (limite 10/éducateur)', async () => {
    const roomId = randomUUID();
    const svc = await mk({ children: 20, rooms: [{ id: roomId, name_fr: 'Salle A', max_capacity: 30, children_count: 20 }], educatorsByRoom: { [roomId]: 2 } });
    const { results } = await svc.runChecks();
    const ratio = resultsByCode(results).get('RATIO_EDUC')!;
    expect(ratio[0].result).toBe('pass');
  });

  test('RATIO_EDUC : 1 seul éducateur → fail (minimum 2)', async () => {
    const roomId = randomUUID();
    const svc = await mk({ children: 5, rooms: [{ id: roomId, name_fr: 'Salle A', max_capacity: 20, children_count: 5 }], educatorsByRoom: { [roomId]: 1 } });
    const { results } = await svc.runChecks();
    const ratio = resultsByCode(results).get('RATIO_EDUC')!;
    expect(ratio[0].result).toBe('fail');
  });

  test('DOC_STAFF : salle avec enfants sans éducateur → fail', async () => {
    const roomId = randomUUID();
    const svc = await mk({ children: 5, rooms: [{ id: roomId, name_fr: 'Salle A', max_capacity: 20, children_count: 5 }], educatorsByRoom: {} });
    const { results } = await svc.runChecks();
    const doc = resultsByCode(results).get('DOC_STAFF')!;
    expect(doc[0].result).toBe('fail');
  });

  test('DOC_STAFF : salle vide → non évaluée (aucun enfant, pas de fail)', async () => {
    const roomId = randomUUID();
    const svc = await mk({ children: 0, rooms: [{ id: roomId, name_fr: 'Salle A', max_capacity: 20, children_count: 0 }], educatorsByRoom: {} });
    const { results } = await svc.runChecks();
    const doc = resultsByCode(results).get('DOC_STAFF')!;
    expect(doc[0].result).toBe('pass');
  });

  test('PRICE_DISPLAY : enfants accueillis sans contrat actif → fail (art. 16)', async () => {
    const svc = await mk({ children: 5, activeContracts: 0 });
    const { results } = await svc.runChecks();
    const price = resultsByCode(results).get('PRICE_DISPLAY')!;
    expect(price[0].result).toBe('fail');
  });

  test('PRICE_DISPLAY : enfants accueillis avec contrat actif → pass', async () => {
    const svc = await mk({ children: 5, activeContracts: 2 });
    const { results } = await svc.runChecks();
    const price = resultsByCode(results).get('PRICE_DISPLAY')!;
    expect(price[0].result).toBe('pass');
  });

  test('PRICE_DISPLAY : aucun enfant → pass (rien à afficher)', async () => {
    const svc = await mk({ children: 0, activeContracts: 0 });
    const { results } = await svc.runChecks();
    const price = resultsByCode(results).get('PRICE_DISPLAY')!;
    expect(price[0].result).toBe('pass');
  });

  test('chaque check est PERSISTÉ dans compliance_checks (audit trail)', async () => {
    const svc = await mk({ children: 5 });
    await svc.runChecks();
    const inserts = executed.filter((q) => q.sql.startsWith('INSERT INTO compliance_checks'));
    expect(inserts.length).toBeGreaterThan(0);
    // l organization_id est toujours le tenant courant
    for (const ins of inserts) expect(ins.params[0]).toBe(ORG);
  });

  test('AGE_CRECHE : établi pour type=creche uniquement', async () => {
    const svc = await mk({ children: 5, establishmentType: 'preschool' });
    const { results } = await svc.runChecks();
    expect(resultsByCode(results).get('AGE_CRECHE')).toBeUndefined();
  });
});
