import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
}

/**
 * Sessions (refresh tokens opaques hachés SHA-256 en base) + rotation.
 *
 * Migration 088 (remédiation RLS) a posé ENABLE + FORCE ROW LEVEL SECURITY
 * sur `sessions` avec la politique `sessions_tenant`
 * (organization_id = app_tenant_id()). La table n'est PLUS une table système
 * « pool direct » : toute écriture doit poser app.tenant_id au préalable.
 * C'est précisément ce qui cassait POST /auth/login (500
 * « new row violates row-level security policy for table "sessions" ») :
 * le login crée la session AVANT que JwtAuthGuard ne pose le contexte de
 * requête, donc app.tenant_id était NULL → WITH CHECK faux → INSERT rejeté.
 * `createSession` pose donc app.tenant_id (si organizationId) avant l'INSERT,
 * puis le retire après (rollback du setting local) pour ne pas fuiter un
 * tenant dans la pool partagée.
 * La signature du JWT access est faite par AuthService (JwtService).
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Explicit client joins a caller-owned transaction (refresh); defaults preserve login callers. */
  async createSession(params: {
    userId: string;
    organizationId: string | null;
    deviceId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }, client: Pick<PoolClient, 'query'> = this.pool): Promise<CreatedSession> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = SessionsService.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours

    // Migration 088 : `sessions` est sous FORCE ROW LEVEL SECURITY avec la
    // politique sessions_tenant (organization_id = app_tenant_id()). Le login
    // arrive AVANT JwtAuthGuard → app.tenant_id est NULL → WITH CHECK faux →
    // « new row violates row-level security policy for table "sessions" ».
    // On pose donc app.tenant_id à partir de l'appartenance résolue (lue en
    // amont, pas encore du token), puis on RESET pour ne pas fuiter le tenant
    // dans la pool partagée. Sur le refresh, l'appelant fournit un client dont
    // app.tenant_id est déjà posé à la même valeur → idempotent.
    // NOTE : is_local=false (SESSION, pas TRANSACTION) — le login n'ouvre pas
    // de BEGIN explicite, donc chaque statement est sa propre transaction
    // implicite et un set_local serait ÉPHÉMÈRE : abandonné avant l'INSERT.
    // RESET app.tenant_id ci-dessous évite la fuite du tenant dans la pool.
    // NOTE : un super-admin sans organization (organization_id NULL) reste
    // bloqué par sessions_tenant car NULL = NULL est NULL en SQL — couvert par
    // la politique permissive 097 (sessions_super_admin_no_org).
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [
      params.organizationId ?? null,
    ]);
    const result = await client.query(
      `INSERT INTO sessions
         (user_id, organization_id, refresh_token_hash, device_id, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        params.userId,
        params.organizationId,
        refreshHash,
        params.deviceId ?? null,
        params.ipAddress ?? null,
        params.userAgent ?? null,
        expiresAt,
      ],
    );
    // Ne pas fuiter app.tenant_id dans la pool partagée (login hors transaction).
    // RESTORE (pas RESET brut) : sur le chemin refresh l'appelant est DANS une
    // transaction qui peut encore écrire sous RLS après createSession — on
    // rétablit donc la valeur pré-existante plutôt que de vider le setting.
    // current_setting(..., true) → '' si absent, et set_config('',''…) via
    // NULLIF ci-dessous restore l'absence de setting sans erreur.
    const prev = (await client.query(`SELECT current_setting('app.tenant_id', true) AS v`)).rows[0].v as string | null;
    const hadSetting = prev !== null && prev !== '';
    if (hadSetting) {
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [prev]);
    } else {
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [null]);
    }

    return { sessionId: result.rows[0].id, refreshToken };
  }

  async revokeByRefreshHash(refreshHash: string, reason = 'logout'): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
      [refreshHash, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Révocation de toutes les sessions d'un utilisateur (reuse détectée, mot de passe changé). */
  async revokeAllForUser(userId: string, reason: string, client: Pick<PoolClient, 'query'> = this.pool): Promise<void> {
    await client.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
    );
  }

  /** Révocation de toutes les sessions liées à un appareil (révocation distante). */
  async revokeByDevice(deviceId: string, organizationId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
       WHERE device_id = $1 AND organization_id = $3 AND revoked_at IS NULL`,
      [deviceId, reason, organizationId],
    );
  }
}
