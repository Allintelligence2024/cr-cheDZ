/**
 * Tests unitaires — garde de configuration de production (MISSION P1,
 * feat(config)) : `@creche/prod-config`, exécutée par l'API ET le worker au
 * bootstrap seulement si NODE_ENV=production.
 *
 * Cas couverts (11) :
 *   1. config de production SÛRE → validate [] + assert ne jette pas ;
 *   2. PAYMENT_WEBHOOK_SECRET absent → bloquée, variable nommée ;
 *   3. PAYMENT_WEBHOOK_SECRET < 32 caractères → bloquée, variable nommée ;
 *   4. JWT_SECRET = défaut de développement (identity.module.ts) → bloquée ;
 *   5. STORAGE_BACKEND=s3 avec S3_ACCESS_KEY/S3_SECRET_KEY = défauts
 *      minio_dev/minio_dev_password → bloquée, variables nommées ;
 *   6. STORAGE_BACKEND=local avec STORAGE_LOCAL_DIR=/tmp/creche-pdf →
 *      bloquée, variable nommée ;
 *   7. config SATIM partielle → bloquée, SATIM_* nommés ;
 *   8. NODE_ENV=test/development → garde INACTIVE (mêmes défauts, pas de
 *      blocage) — ne rien casser en test/development ;
 *   9. G5 : TOTP_ENCRYPTION_KEY absente/malformée en production → bloquée ;
 *  10. RATE_LIMIT_DISABLED='true' ou '1' en production → bloquée (lot 1 du
 *      plan de réparation 2026-09-24 : le garde applicatif les interprète
 *      comme une désactivation, sans regarder NODE_ENV) ; 'false'/absente
 *      admises — sinon on bloquerait une configuration saine ;
 *  11. rappel : hors production, RATE_LIMIT_DISABLED reste libre (tests et
 *      runner d'isolation l'exportent à '1').
 */
import { assertProductionConfig, validateProductionConfig } from '@creche/prod-config';

const safeEnv = {
  NODE_ENV: 'production',
  PAYMENT_WEBHOOK_SECRET: 'webhook-secret-0123456789abcdef0123456789',
  JWT_SECRET: 'jwt-secret-0123456789abcdef0123456789',
  STORAGE_BACKEND: 's3',
  S3_ACCESS_KEY: 'prod-access-key',
  S3_SECRET_KEY: 'prod-secret-key',
  SATIM_MERCHANT_ID: 'merchant-prod',
  SATIM_SECRET: 'satim-prod-secret',
  SATIM_GATEWAY_URL: 'https://pay.satim.dz/rest',
  // G5 : chiffrement au repos des secrets TOTP — clé de 32 octets (hex) requise en production.
  TOTP_ENCRYPTION_KEY: 'b'.repeat(64),
};

describe('@creche/prod-config — garde de configuration (NODE_ENV=production)', () => {
  test('config sûre : validate() vide et assert() ne jette pas', () => {
    expect(validateProductionConfig(safeEnv)).toEqual([]);
    expect(() => assertProductionConfig(safeEnv)).not.toThrow();
  });

  test('G5 : TOTP_ENCRYPTION_KEY absent → bloquée (variable nommée, pas de clair en prod)', () => {
    const { TOTP_ENCRYPTION_KEY: _omitted, ...env } = safeEnv;
    expect(validateProductionConfig(env).join('\n')).toMatch(/TOTP_ENCRYPTION_KEY/);
    expect(() => assertProductionConfig(env)).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  test('G5 : TOTP_ENCRYPTION_KEY malformée → bloquée partout ; liste de rotation admise', () => {
    expect(() => assertProductionConfig({ ...safeEnv, TOTP_ENCRYPTION_KEY: 'trop-court' })).toThrow(/TOTP_ENCRYPTION_KEY/);
    expect(() => assertProductionConfig({ ...safeEnv, TOTP_ENCRYPTION_KEY: 'y'.repeat(20) })).toThrow(/TOTP_ENCRYPTION_KEY/);
    expect(validateProductionConfig({ ...safeEnv, TOTP_ENCRYPTION_KEY: `${'c'.repeat(64)},${'b'.repeat(64)}` })).toEqual([]);
    expect(() => assertProductionConfig({ ...safeEnv, NODE_ENV: 'test', TOTP_ENCRYPTION_KEY: 'nope' })).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  test('PAYMENT_WEBHOOK_SECRET absent → bloquée (variable nommée)', () => {
    const { PAYMENT_WEBHOOK_SECRET: _omitted, ...env } = safeEnv;
    const problems = validateProductionConfig(env);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('PAYMENT_WEBHOOK_SECRET');
    expect(() => assertProductionConfig(env)).toThrow('PAYMENT_WEBHOOK_SECRET');
  });

  test('PAYMENT_WEBHOOK_SECRET < 32 caractères → bloquée (variable nommée)', () => {
    const env = { ...safeEnv, PAYMENT_WEBHOOK_SECRET: 'phase8-test-secret' };
    const problems = validateProductionConfig(env);
    expect(problems.join('\n')).toContain('PAYMENT_WEBHOOK_SECRET');
    expect(problems.join('\n')).toContain('32');
    expect(() => assertProductionConfig(env)).toThrow('PAYMENT_WEBHOOK_SECRET');
  });

  test('JWT_SECRET = défaut de développement → bloquée (variable nommée)', () => {
    const env = { ...safeEnv, JWT_SECRET: 'dev_jwt_secret_change_in_prod_minimum_32_chars' };
    const problems = validateProductionConfig(env);
    expect(problems.join('\n')).toContain('JWT_SECRET');
    expect(problems.join('\n')).toContain('défaut de développement');
    expect(() => assertProductionConfig(env)).toThrow('JWT_SECRET');
  });

  test('STORAGE_BACKEND=s3 avec clés minio_dev/minio_dev_password → bloquée', () => {
    const env = { ...safeEnv, S3_ACCESS_KEY: 'minio_dev', S3_SECRET_KEY: 'minio_dev_password' };
    const problems = validateProductionConfig(env);
    expect(problems.join('\n')).toContain('S3_ACCESS_KEY');
    expect(problems.join('\n')).toContain('S3_SECRET_KEY');
    expect(() => assertProductionConfig(env)).toThrow('S3_ACCESS_KEY');
  });

  test('STORAGE_BACKEND=local avec /tmp/creche-pdf → bloquée (variable nommée)', () => {
    const env = { ...safeEnv, STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '/tmp/creche-pdf' };
    const problems = validateProductionConfig(env);
    expect(problems.join('\n')).toContain('STORAGE_LOCAL_DIR');
    expect(problems.join('\n')).toContain('/tmp/creche-pdf');
    expect(() => assertProductionConfig(env)).toThrow('STORAGE_LOCAL_DIR');
  });

  test('config SATIM partielle → bloquée (SATIM_* nommés)', () => {
    const env = { ...safeEnv, SATIM_SECRET: undefined };
    const problems = validateProductionConfig(env);
    expect(problems.join('\n')).toContain('SATIM_SECRET');
    expect(problems.join('\n')).toContain('SATIM_MERCHANT_ID');
    expect(() => assertProductionConfig(env)).toThrow('SATIM');
  });

  test('NODE_ENV=test/development → garde INACTIVE (mêmes défauts acceptés)', () => {
    const faulty = { ...safeEnv, PAYMENT_WEBHOOK_SECRET: 'court', JWT_SECRET: 'dev_jwt_secret_change_in_prod_minimum_32_chars' };
    expect(() => assertProductionConfig({ ...faulty, NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertProductionConfig({ ...faulty, NODE_ENV: 'development' })).not.toThrow();
  });

  test("L1 : RATE_LIMIT_DISABLED='true'|'1' bloquée en production, 'false'/absente admise", () => {
    // Le garde applicatif (rate-limit.guard.ts) sort en `true` pour ces deux
    // valeurs SANS regarder NODE_ENV : démarrer la production avec elles
    // revient à désarmer la limitation de débit applicative.
    for (const value of ['true', '1']) {
      expect(validateProductionConfig({ ...safeEnv, RATE_LIMIT_DISABLED: value }).join('\n')).toMatch(/RATE_LIMIT_DISABLED/);
      expect(() => assertProductionConfig({ ...safeEnv, RATE_LIMIT_DISABLED: value })).toThrow(/RATE_LIMIT_DISABLED/);
    }
    // Valeurs que le garde N'interprète PAS comme une désactivation, et
    // configuration saine : aucune ne doit être refusée (pas de sur-blocage).
    for (const value of ['false', '0', '', undefined]) {
      expect(validateProductionConfig({ ...safeEnv, RATE_LIMIT_DISABLED: value })).toEqual([]);
    }
    // Hors production : la variable reste libre (tests, runner d'isolation).
    expect(() => assertProductionConfig({ ...safeEnv, NODE_ENV: 'test', RATE_LIMIT_DISABLED: '1' })).not.toThrow();
  });
});
