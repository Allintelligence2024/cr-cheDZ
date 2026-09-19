import { Pool } from 'pg';
import { assertApplicationDatabaseRole } from '@creche/prod-config';

export const PG_POOL = Symbol('PG_POOL');

/** URL de développement historique — JAMAIS atteignable en production. */
const DEV_FALLBACK_URL = 'postgresql://creche_app:dev_password_change_in_prod@localhost:5432/creche_dev';

/**
 * D2 (remédiation audits combinés) : en production, l'absence de
 * DATABASE_URL est FATALE — plus de repli silencieux vers la base dev.
 * Hors production, le repli historique est conservé pour le confort local.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL requis en production — aucun repli implicite vers la base de développement');
  }
  return DEV_FALLBACK_URL;
}

export const databaseProvider = {
  provide: PG_POOL,
  useFactory: async (): Promise<Pool> => {
    const pool = new Pool({ connectionString: resolveDatabaseUrl(), max: 10, idleTimeoutMillis: 30_000 });
    try {
      await assertApplicationDatabaseRole(pool);
      return pool;
    } catch (error) {
      await pool.end();
      throw error;
    }
  },
};
