/**
 * Tests unitaires — DashboardService (4.2, couverture hors-plan).
 *
 * Le tableau de bord de la directrice agrège des données TOUTES limitées au
 * tenant courant via `withTenantConnection`. L'invariant testé ici est
 * l'ISOLEMENT : chaque requête filtre sur `organization_id = $1` où $1 est
 * le tenant exigé AVANT toute lecture (requireTenant), jamais un paramètre
 * client. Les alertes (non pointés, documents expirant, impayés, incidents)
 * doivent aussi être bornées (LIMIT) pour ne pas saturer la directrice.
 */
import { randomUUID } from 'node:crypto';

describe('DashboardService.summary (isolation + alertes)', () => {
  const ORG = randomUUID();
  let executed: Array<{ sql: string; params: unknown[] }>;

  const mk = async () => {
    const { DashboardService } = await import('./dashboard.service');
    executed = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        executed.push({ sql: compact, params });
        if (compact.startsWith('SELECT (NOW() AT TIME ZONE')) return { rows: [{ d: '2026-10-06' }], rowCount: 1 };
        if (compact.startsWith('SELECT r.id AS room_id')) return { rows: [{ room_id: randomUUID(), room_name: 'Salle A', site_name: 'Site 1', total_children: 10, present: 6, departed: 2, absent: 1, expected: 1 }], rowCount: 1 };
        if (compact.startsWith('SELECT c.id, c.reference_number')) return { rows: [], rowCount: 0 };
        if (compact.startsWith('SELECT sd.id, sd.document_type')) return { rows: [], rowCount: 0 };
        if (compact.startsWith('SELECT i.id, i.invoice_number')) return { rows: [], rowCount: 0 };
        if (compact.startsWith('SELECT e.id, e.child_id')) return { rows: [], rowCount: 0 };
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const ratios = {
      compute: async () => ({ rooms: [{ room_id: randomUUID(), ratio: 5, max_ratio: 10 }], alerts: [] }),
    } as unknown as import('../attendance/ratios.service').RatiosService;
    return new DashboardService(tenantContext, ratios);
  };

  test('chaque requête filtre sur organization_id = $1 (jamais de tenant client)', async () => {
    const svc = await mk();
    await svc.summary();
    const tenantScoped = executed.filter((q) => q.sql.includes('organization_id = $1') || q.sql.includes('organization_id=$1'));
    // rooms, notCheckedIn, documentsExpiring, unpaidInvoices, recentIncidents
    expect(tenantScoped.length).toBeGreaterThanOrEqual(5);
    for (const q of tenantScoped) expect(q.params[0]).toBe(ORG);
  });

  test('la date du jour est en fuseau Algiers (pas CURRENT_DATE serveur)', async () => {
    const svc = await mk();
    const res = await svc.summary();
    expect(res.date).toBe('2026-10-06');
    expect(executed.some((q) => q.sql.includes("AT TIME ZONE 'Africa/Algiers'"))).toBe(true);
  });

  test('la structure de la réponse est stable (rooms + ratios + 5 alertes)', async () => {
    const svc = await mk();
    const res = await svc.summary();
    expect(res).toHaveProperty('date');
    expect(res).toHaveProperty('rooms');
    expect(res).toHaveProperty('ratios');
    expect(res.alerts).toHaveProperty('ratio_breaches');
    expect(res.alerts).toHaveProperty('children_not_checked_in');
    expect(res.alerts).toHaveProperty('documents_expiring');
    expect(res.alerts).toHaveProperty('unpaid_invoices');
    expect(res.alerts).toHaveProperty('recent_incidents');
  });

  test('les alertes sont BORNÉES (LIMIT) pour rester utilisables', async () => {
    const svc = await mk();
    await svc.summary();
    const limited = executed.filter((q) => /\blimit\b/i.test(q.sql));
    expect(limited.length).toBeGreaterThanOrEqual(4);
    for (const q of limited) expect(q.sql).toMatch(/LIMIT \d+/);
  });

  test('les factures impayées incluent les statuts réels (sent, partially_paid, overdue)', async () => {
    const svc = await mk();
    await svc.summary();
    const inv = executed.find((q) => q.sql.startsWith('SELECT i.id, i.invoice_number'));
    expect(inv).toBeDefined();
    expect(inv!.sql).toContain("'sent'");
    expect(inv!.sql).toContain("'partially_paid'");
    expect(inv!.sql).toContain("'overdue'");
  });

  test('les incidents sont limités aux dernières 24 h', async () => {
    const svc = await mk();
    await svc.summary();
    const inc = executed.find((q) => q.sql.startsWith('SELECT e.id, e.child_id'));
    expect(inc).toBeDefined();
    expect(inc!.sql).toContain("INTERVAL '24 hours'");
  });

  test('les documents expirant le sont sous 30 jours (date Algiers, pas serveur)', async () => {
    const svc = await mk();
    await svc.summary();
    const docs = executed.find((q) => q.sql.startsWith('SELECT sd.id, sd.document_type'));
    expect(docs).toBeDefined();
    expect(docs!.sql).toContain("+ 30");
    expect(docs!.sql).toContain("AT TIME ZONE 'Africa/Algiers'");
  });
});
