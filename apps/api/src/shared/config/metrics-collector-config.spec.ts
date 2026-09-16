/**
 * Tests unitaires — H2k : configuration du credential de collecte Prometheus.
 *
 * La garde partagée ne voit que des DIGESTS SHA-256 (jamais le secret brut) ;
 * une liste malformée doit (1) désactiver le chemin collecteur (fail-closed)
 * et (2) bloquer le démarrage en production sans échoer les valeurs fautes.
 */
import {
  METRICS_COLLECTOR_HASHES_ENV,
  assertProductionConfig,
  parseMetricsCollectorConfig,
  validateMetricsCollectorConfig,
} from '@creche/prod-config';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = '0123456789abcdef'.repeat(4);

describe(`@creche/prod-config — ${METRICS_COLLECTOR_HASHES_ENV} (H2k)`, () => {
  test('absent : collecteur désactivé, aucun problème de config', () => {
    const parsed = parseMetricsCollectorConfig({});
    expect(parsed).toEqual({ enabled: false, hashes: [], invalidEntries: [] });
    expect(validateMetricsCollectorConfig({})).toEqual([]);
  });

  test('digests valides : normalisation minuscule, déduplication et espaces tolérés', () => {
    const parsed = parseMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: `${DIGEST_A.toUpperCase()}, ${DIGEST_A},,${DIGEST_B},` });
    expect(parsed.enabled).toBe(true);
    expect(parsed.hashes).toEqual([DIGEST_A, DIGEST_B]);
    expect(parsed.invalidEntries).toEqual([]);
  });

  test('entrée malformée (token brut, hex court) : désactivé + index sans écho de la valeur', () => {
    const bad = 'super-secret-collecteur-en-clair';
    const parsed = parseMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: `${DIGEST_A},${bad},abc` });
    expect(parsed.enabled).toBe(false);
    expect(parsed.invalidEntries).toEqual([2, 3]);
    const [problem] = validateMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: `${DIGEST_A},${bad},abc` });
    expect(problem).toContain(METRICS_COLLECTOR_HASHES_ENV);
    expect(problem).toContain('n° 2, 3');
    expect(problem).not.toContain(bad);
  });

  test('liste vide ou que des virgules : désactivé (pas de problème bloquant)', () => {
    expect(parseMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: '' }).enabled).toBe(false);
    expect(parseMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: ' , , ' })).toEqual({ enabled: false, hashes: [], invalidEntries: [] });
    expect(validateMetricsCollectorConfig({ [METRICS_COLLECTOR_HASHES_ENV]: ' , , ' })).toEqual([]);
  });

  test('production : démarrage refusé sur liste malformée ; liste saine et absence acceptées', () => {
    const base = {
      NODE_ENV: 'production',
      PAYMENT_WEBHOOK_SECRET: 'webhook-secret-0123456789abcdef0123456789',
      JWT_SECRET: 'jwt-secret-0123456789abcdef0123456789',
      STORAGE_BACKEND: 's3',
      S3_ACCESS_KEY: 'prod-access-key',
      S3_SECRET_KEY: 'prod-secret-key',
    };
    expect(() => assertProductionConfig({ ...base, [METRICS_COLLECTOR_HASHES_ENV]: 'nope' })).toThrow(/METRICS_COLLECTOR_TOKEN_HASHES/);
    expect(() => assertProductionConfig({ ...base, [METRICS_COLLECTOR_HASHES_ENV]: DIGEST_A })).not.toThrow();
    expect(() => assertProductionConfig(base)).not.toThrow();
  });
});
