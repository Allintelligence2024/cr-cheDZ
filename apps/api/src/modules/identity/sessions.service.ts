import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
}

/**
 * Sessions (refresh tokens opaques hachés SHA-256 en base) + rotation.
 * Table sessions = table système (pas de RLS) → pool direct.
 * La signature du JWT access est faite par AuthService (JwtService).
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createSession(params: {
    userId: string;
    organizationId: string | null;
    deviceId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<CreatedSession> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = SessionsService.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours

    const result = await this.pool.query(
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
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.pool.query(
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
