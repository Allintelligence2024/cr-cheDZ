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
    // Migration 088 : `sessions` est FORCE RLS (politique sessions_tenant sur
    // organization_id). Un UPDATE brut sur la pool sans GUC app.tenant_id ne
    // voit AUCUNE ligne (organization_id = NULL est NULL) : le logout
    // répondait 204 sans révoquer quoi que ce soit — le refresh token restait
    // valable jusqu'à expiration. On résout donc d'abord la session via la
    // fonction SECURITY DEFINER existante (preuve par hachage du token),
    // puis on pose le GUC le temps de l'UPDATE et on RESTORE la valeur
    // précédente (pool partagée — jamais de fuite de tenant entre requêtes).
    const row = (await this.pool.query(
      `SELECT session_id, organization_id FROM auth_refresh_lookup($1)`, [refreshHash],
    )).rows[0] as { id: string; organization_id: string | null } | undefined;
    if (!row) return false;
    if (!row.organization_id) {
      // rls-guard: allow sessions hors organisation (super_admin) — policy permissive sessions_super_admin_no_org (migration 097, USING organization_id IS NULL) : visible SANS GUC tenant ; le filtre revient sur organization_id IS NULL.
      // Session hors organisation (super-admin) : politique permissive 097.
      const result = await this.pool.query(
        `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND organization_id IS NULL`,
        [refreshHash, reason],
      );
      return (result.rowCount ?? 0) > 0;
    }
    const prev = (await this.pool.query(`SELECT current_setting('app.tenant_id', true) AS v`)).rows[0].v as string | null;
    await this.pool.query(`SELECT set_config('app.tenant_id', $1, false)`, [row.organization_id]);
    try {
      // rls-guard: allow sessions FORCE RLS (088) — GUC app.tenant_id posé juste au-dessus depuis auth_refresh_lookup, restauré après ; portée réduite au hachage du token de la requête courante.
      const result = await this.pool.query(
        `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
        [refreshHash, reason],
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      await this.pool.query(`SELECT set_config('app.tenant_id', $1, false)`, [prev ?? '']);
    }
  }

  /**
   * Révocation de toutes les sessions d'un utilisateur (reuse détecté, mot de passe changé).
   *
   * `sessions` est FORCE RLS (088) : un UPDATE brut sur la pool — appelant
   * inclus — ne verrait aucune ligne. La sémantique est COMPTE (toutes les
   * sessions, toutes organisations confondues pour un directeur multi-org),
   * portée par la fonction SECURITY DEFINER `sessions_revoke_all_for_user`
   * (migration 100). Quand l'appelant fournit un client (transaction de
   * refresh), le GUC y est déjà posé par auth.service : le SQL direct reste
   * alors correct et la transaction verrouille la révocation avec la rotation.
   */
  async revokeAllForUser(userId: string, reason: string, client?: Pick<PoolClient, 'query'>): Promise<void> {
    if (client) {
      await client.query(
        `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, reason],
      );
      return;
    }
    // rls-guard: allow sessions FORCE RLS (088) — suppression via fonction SECURITY DEFINER sessions_revoke_all_for_user (migration 100), portée COMPTE assumée après preuve d'authentification.
    await this.pool.query(`SELECT sessions_revoke_all_for_user($1, $2)`, [userId, reason]);
  }

  /** Révocation de toutes les sessions liées à un appareil (révocation distante). */
  async revokeByDevice(deviceId: string, organizationId: string, reason: string): Promise<void> {
    // rls-guard: allow sessions FORCE RLS (088) — suppression via fonction SECURITY DEFINER sessions_revoke_by_device (migration 100), filtre (device, organisation) conservé en paramètre.
    await this.pool.query(`SELECT sessions_revoke_by_device($1, $2, $3)`, [deviceId, organizationId, reason]);
  }
}
