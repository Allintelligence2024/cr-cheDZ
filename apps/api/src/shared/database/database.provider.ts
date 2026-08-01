import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

export const databaseProvider = {
  provide: PG_POOL,
  useFactory: (): Pool => {
    const connectionString =
      process.env.DATABASE_URL ??
      'postgresql://creche_app:dev_password_change_in_prod@localhost:5432/creche_dev';
    return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  },
};
