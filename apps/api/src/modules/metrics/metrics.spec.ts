/**
 * Tests unitaires — MetricsService + MetricsCollectorService (4.2, couverture
 * hors-plan).
 *
 * Enjeu : `/api/v1/metrics` expose des agrégats INTER-tenant. La route est
 * @Public(), donc TOUT repose sur deux autorités :
 *   1. le collecteur Prometheus — secret opaque comparé DIGEST contre DIGEST
 *      en temps constant (jamais le token brut en config) ;
 *   2. le super_admin — mais relu en base à chaque scrape (un compte révoqué
 *      ou verrouillé perd l'accès immédiatement, G4).
 *
 * Une config malformée doit être refusée EN BLOC (fail-closed), jamais
 * partiellement : un attaquant ne doit pas pouvoir se voir accorder le
 * chemin collecteur parce qu'une entrée invalide a été ignorée.
 */
import { createHash } from 'node:crypto';

// ── MetricsCollectorService — chemin collecteur ────────────────────────────

describe('MetricsCollectorService.accepts (H2k)', () => {
  const TOKEN = 'c'.repeat(64);
  const digest = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

  const mk = async () => (await import('./metrics-collector.service')).MetricsCollectorService;

  afterEach(() => {
    // restore env
    delete process.env.METRICS_COLLECTOR_TOKEN_HASHES;
  });

  test('token valide dont le digest est provisionné → accepté', async () => {
    process.env.METRICS_COLLECTOR_TOKEN_HASHES = digest(TOKEN);
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(true);
  });

  test('token absent de la liste → refusé (jamais de wildcard)', async () => {
    process.env.METRICS_COLLECTOR_TOKEN_HASHES = digest('other-secret');
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(false);
  });

  test('config vide → chemin collecteur désactivé (fail-closed)', async () => {
    delete process.env.METRICS_COLLECTOR_TOKEN_HASHES;
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(false);
  });

  test('config malformée → refusée EN BLOC, même si un digest est valide', async () => {
    // un digest valide + une entrée invalide : tout le chemin est coupé,
    // pas seulement l'entrée invalide.
    process.env.METRICS_COLLECTOR_TOKEN_HASHES = `${digest(TOKEN)},not-a-hex-digest`;
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(false);
  });

  test('token brut en config → jamais accepté (seul le digest est provisionné)', async () => {
    // Erreur de provisioning classique : l'opérateur met le TOKEN en clair.
    // Le digest présenté (sha256(TOKEN)) ne correspond pas au digest du token
    // traité comme un digest — donc refus.
    process.env.METRICS_COLLECTOR_TOKEN_HASHES = TOKEN;
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(false);
  });

  test('plusieurs digests provisionnés → chacun accepté', async () => {
    const t2 = 'd'.repeat(64);
    process.env.METRICS_COLLECTOR_TOKEN_HASHES = `${digest(TOKEN)},${digest(t2)}`;
    const svc = new (await mk())();
    expect(svc.accepts(TOKEN)).toBe(true);
    expect(svc.accepts(t2)).toBe(true);
  });
});

// ── MetricsService — autorité super_admin (relecture base) ─────────────────

describe('MetricsService.scrape (autorité relecture base)', () => {
  const ADMIN = crypto.randomUUID();

  const mk = async (overrides: {
    adminRow?: Array<Record<string, unknown>>;
    dbGaugesError?: boolean;
  } = {}) => {
    const { MetricsService } = await import('./metrics.service');
    const pool = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT id FROM users')) {
          return { rows: overrides.adminRow ?? [{ id: ADMIN }], rowCount: (overrides.adminRow?.length ?? 1) > 0 ? 1 : 0 };
        }
        if (compact.includes('metrics_global_counts()')) {
          if (overrides.dbGaugesError) throw new Error('function not found');
          return { rows: [
            { metric: 'jobs_pending', n: '3' },
            { metric: 'children_active', n: '42' },
          ], rowCount: 2 };
        }
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    } as unknown as import('pg').Pool;
    return new MetricsService(pool);
  };

  test('super_admin actif → scrape autorisé, jauges exposées', async () => {
    const svc = await mk({ adminRow: [{ id: ADMIN }] });
    const out = await svc.scrape(ADMIN);
    expect(out).toContain('creche_jobs_pending 3');
    expect(out).toContain('creche_children_active 42');
    expect(out).toContain('# TYPE http_requests_total counter');
  });

  test('compte non super_admin → 403 forbidden', async () => {
    const svc = await mk({ adminRow: [] });
    await expect(svc.scrape(ADMIN)).rejects.toMatchObject({ status: 403 });
  });

  test('fonction metrics_global_counts() absente → jauges NaN (jamais de faux 0)', async () => {
    const svc = await mk({ adminRow: [{ id: ADMIN }], dbGaugesError: true });
    const out = await svc.scrape(ADMIN);
    // indisponible s'écrit NaN, pas 0 : un 0 mensonger cacherait une panne.
    expect(out).toContain('creche_jobs_pending NaN');
    expect(out).toContain('# TYPE creche_jobs_pending gauge');
  });
});

// ── MetricsService — exposition des compteurs HTTP ──────────────────────────

describe('MetricsService.httpRequest (compteurs + histogramme)', () => {
  const mk = async () => {
    const { MetricsService } = await import('./metrics.service');
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    return new MetricsService(pool);
  };

  test('un 5xx alimente la fenêtre glissante 24 h', async () => {
    const svc = await mk();
    svc.httpRequest('GET', '/api/v1/children', 500, 0.1);
    svc.httpRequest('GET', '/api/v1/children', 200, 0.05);
    const out = await svc.scrapeCollector();
    expect(out).toContain('creche_http_5xx_24h 1');
    expect(out).toContain('http_requests_total{method="GET",route="/api/v1/children",status="500"} 1');
    expect(out).toContain('http_requests_total{method="GET",route="/api/v1/children",status="200"} 1');
  });

  test('un 4xx ne compte PAS comme 5xx', async () => {
    const svc = await mk();
    svc.httpRequest('POST', '/api/v1/children', 422, 0.2);
    const out = await svc.scrapeCollector();
    expect(out).toContain('creche_http_5xx_24h 0');
  });

  test('histogramme : chaque bucket est exporté, le +Inf inclus', async () => {
    const svc = await mk();
    svc.httpRequest('GET', '/api/v1/health', 200, 0.03);
    const out = await svc.scrapeCollector();
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",route="/api/v1/health",le="0.01"} 0');
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",route="/api/v1/health",le="0.05"} 1');
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",route="/api/v1/health",le="+Inf"} 1');
    expect(out).toContain('http_request_duration_seconds_count{method="GET",route="/api/v1/health"} 1');
  });

  test('label échappé : un backslash ou un guillemet ne casse pas le format', async () => {
    const svc = await mk();
    svc.httpRequest('GET', '/api/v1/"weird"\\route', 200, 0.01);
    const out = await svc.scrapeCollector();
    // pas de ligne cassée : le label est échappé
    expect(out).toContain('route="/api/v1/\\"weird\\"\\\\route"');
    for (const line of out.split('\n')) {
      if (line.startsWith('http_requests_total{')) {
        expect(line.split('"').length % 2).toBe(1);
      }
    }
  });
});
