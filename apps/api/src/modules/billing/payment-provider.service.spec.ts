/**
 * Tests unitaires — PaymentProviderService (audit, étape 4.4).
 *
 * Le bug P0 (UPDATE payments via pool brute : 0 ligne silencieuse sous
 * NOBYPASSRLS) aurait été détecté ICI : ces tests vérifient, pool et
 * contexte TENANT MOCKÉS, les trois chemins de createOnlinePayment :
 *   1. SUCCÈS  → gateway_response persistée via withTenantConnection ;
 *   2. rowCount=0 sur l'UPDATE de persistance → 500 PAYMENT_STATE_ERROR
 *      (jamais de « réussi » non persisté) ;
 *   3. ÉCHEC passerelle → 502 PAYMENT_GATEWAY_ERROR + paiement 'failed'
 *      persisté via withTenantConnection.
 *
 * La passerelle SATIM est simulée en monkey-patchant global.fetch.
 */
import { randomUUID } from 'node:crypto';

interface QueryCall { sql: string; params: unknown[] }

describe('PaymentProviderService.createOnlinePayment', () => {
  const ORG = randomUUID();
  const USER = randomUUID();
  const INVOICE = randomUUID();

  let clientQueries: QueryCall[];
  let tenantRows: Record<string, Array<Record<string, unknown>>>;
  let client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> };
  let service: import('./payment-provider.service').PaymentProviderService;

  const invoiceRow = { id: INVOICE, child_id: randomUUID(), total_amount: '10000.00', paid_amount: '0', status: 'sent' };

  const setup = async (overrides: {
    updateRowCount?: number;
    fetchImpl?: typeof fetch;
  } = {}) => {
    const { PaymentProviderService } = await import('./payment-provider.service');
    clientQueries = [];
    tenantRows = {
      feature_flags: [{ enabled: true }],
      invoices: [invoiceRow],
      payments_insert: [{ id: randomUUID(), reference_number: 'ONL-1', amount: '10000.00', method: 'cib', status: 'pending', external_reference: 'satim-x' }],
      next_org_sequence: [{ n: 1 }],
    };
    client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        clientQueries.push({ sql: compact, params });
        if (compact.startsWith('SELECT COALESCE(f_org')) return { rows: tenantRows.feature_flags, rowCount: 1 };
        if (compact.includes('FROM invoices WHERE id=$1 FOR UPDATE')) return { rows: tenantRows.invoices, rowCount: 1 };
        if (compact.includes('next_org_sequence')) return { rows: tenantRows.next_org_sequence, rowCount: 1 };
        if (compact.startsWith('INSERT INTO payments')) return { rows: tenantRows.payments_insert, rowCount: 1 };
        if (compact.startsWith('UPDATE payments SET gateway_response')) {
          return { rows: [], rowCount: overrides.updateRowCount ?? 1 };
        }
        if (compact.startsWith('UPDATE payments SET status=')) return { rows: [], rowCount: 1 };
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const config = {
      get: (key: string, _def?: string) => ({
        SATIM_MERCHANT_ID: 'merchant-test',
        SATIM_SECRET: 'secret-test',
        SATIM_GATEWAY_URL: 'http://gateway.test',
      } as Record<string, string>)[key],
    } as unknown as import('@nestjs/config').ConfigService;
    const originalFetch = global.fetch;
    if (overrides.fetchImpl) global.fetch = overrides.fetchImpl;
    try {
      service = new PaymentProviderService(tenantContext, config);
      return { originalFetch };
    } finally {
      // fetch restauré par l'appelant après l'assertion.
    }
  };

  const restoreFetch = (originalFetch: typeof fetch) => { global.fetch = originalFetch; };

  const gatewayOk: typeof fetch = (async () =>
    new Response(JSON.stringify({ redirect_url: 'https://pay.test/x', transaction_id: 'TX-1' }), { status: 200 })) as unknown as typeof fetch;

  const gatewayDown: typeof fetch = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('SUCCÈS : gateway_response persistée via withTenantConnection (le P0 serait mort ici)', async () => {
    const { originalFetch } = await setup({ fetchImpl: gatewayOk });
    try {
      const result = await service.createOnlinePayment(USER, { invoice_id: INVOICE, method: 'cib' });
      const update = clientQueries.find((q) => q.sql.startsWith('UPDATE payments SET gateway_response'));
      expect(update).toBeDefined();
      expect(update!.params[1]).toContain('redirect_url');
      expect(result.redirect_url).toBe('https://pay.test/x');
      expect(result.status ?? 'pending').toBeTruthy();
    } finally {
      restoreFetch(originalFetch);
    }
  });

  test('rowCount=0 → 500 PAYMENT_STATE_ERROR (jamais de succès silencieux)', async () => {
    const { originalFetch } = await setup({ updateRowCount: 0, fetchImpl: gatewayOk });
    try {
      await expect(
        service.createOnlinePayment(USER, { invoice_id: INVOICE, method: 'cib' }),
      ).rejects.toMatchObject({
        code: 'PAYMENT_STATE_ERROR',
        status: 500,
        messageFr: expect.stringContaining('passerelle'),
        messageAr: expect.stringContaining('الدفع'),
      });
    } finally {
      restoreFetch(originalFetch);
    }
  });

  test('ÉCHEC passerelle → 502 PAYMENT_GATEWAY_ERROR + paiement failed persisté', async () => {
    const { originalFetch } = await setup({ fetchImpl: gatewayDown });
    try {
      await expect(
        service.createOnlinePayment(USER, { invoice_id: INVOICE, method: 'cib' }),
      ).rejects.toMatchObject({ code: 'PAYMENT_GATEWAY_ERROR', status: 502 });
      const failed = clientQueries.find((q) => q.sql.startsWith('UPDATE payments SET status='));
      expect(failed).toBeDefined();
      expect(failed!.sql).toContain("'failed'");
      expect(String(failed!.params[1])).toContain('ECONNREFUSED');
    } finally {
      restoreFetch(originalFetch);
    }
  });
});
