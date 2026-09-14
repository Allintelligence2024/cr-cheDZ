import { Pool } from 'pg';
import { assertApplicationDatabaseRole } from '@creche/prod-config';

export const PG_POOL = Symbol('PG_POOL');

export const databaseProvider = {
  provide: PG_POOL,
  useFactory: async (): Promise<Pool> => {
    const connectionString =
      process.env.DATABASE_URL ??
      'postgresql://creche_app:dev_password_change_in_prod@localhost:5432/creche_dev';
    const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    try {
      await assertApplicationDatabaseRole(pool);
      return pool;
    } catch (error) {
      await pool.end();
      throw error;
    }
  },
};
