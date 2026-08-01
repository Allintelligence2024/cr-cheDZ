import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from './database.provider';
import { getRequestContext } from '../context/request-context';

/**
 * Contexte tenant de la requête courante (stocké dans l'AsyncLocalStorage,
 * rempli par JwtAuthGuard après vérification du JWT).
 *
 * Toute lecture/écriture sur une table tenant DOIT passer par
 * withTenantConnection() : BEGIN → set_config('app.tenant_id'/'app.user_id')
 * → callback → COMMIT/ROLLBACK.
 *
 * Comportement safe-by-default : sans tenant posé, les politiques RLS sont
 * toutes fausses → 0 ligne (jamais de fuite).
 */
@Injectable()
export class TenantContextService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  setContext(tenantId: string, userId: string): void {
    const store = getRequestContext();
    if (!store) throw new Error('Contexte de requête absent (middleware manquant)');
    store.tenantId = tenantId;
    store.userId = userId;
  }

  getTenantId(): string {
    const tenantId = this.getTenantIdOrNull();
    if (!tenantId) throw new Error('Tenant context non initialisé');
    return tenantId;
  }

  getTenantIdOrNull(): string | null {
    return getRequestContext()?.tenantId ?? null;
  }

  getUserId(): string | null {
    return getRequestContext()?.userId ?? null;
  }

  async withTenantConnection<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const store = getRequestContext();
    try {
      await client.query('BEGIN');
      if (store?.tenantId) {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', store.tenantId]);
      }
      if (store?.userId) {
        await client.query('SELECT set_config($1, $2, true)', ['app.user_id', store.userId]);
      }
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
