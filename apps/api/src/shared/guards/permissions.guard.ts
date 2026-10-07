import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Pool } from 'pg';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import { Errors } from '../errors';

/**
 * Garde RBAC fondée sur la matrice `role_permissions` (migration 003, seed 003).
 *
 * `@Permissions('health:medicate')` vérifie que l'utilisateur dispose de la
 * permission dans SON organisation — résolu via `auth_user_permissions()`
 * (migration 084, SECURITY DEFINER) qui joint les rôles effectifs
 * (auth_user_roles, migration 040) à role_permissions.
 *
 * Pourquoi pas le JWT : les permissions ne sont pas embarquées dans le token
 * (seuls les slugs de rôles y sont). Une révocation de permission prend effet
 * immédiatement, sans devoir réémettre les tokens — attendu pour la loi 25-11
 * (séparation DPO : on retire privacy:manage au director et ça s'applique tout
 * de suite, pas à la prochaine connexion).
 *
 * Sémantique : aucune métadonnée `@Permissions` → laisse passer (la route est
 * publique ou déjà filtrée par @Roles). Clés multiples = OU.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions =
      (Reflect.getMetadata(PERMISSIONS_KEY, context.getHandler()) as string[] | undefined) ??
      (Reflect.getMetadata(PERMISSIONS_KEY, context.getClass()) as string[] | undefined);
    if (!permissions || permissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as (CurrentUserPayload & { roles?: string[] }) | undefined;
    if (!user) throw Errors.forbidden();

    // super_admin contourne la matrice (rôle plateforme, pas un rôle crèche).
    if (user.isSuperAdmin) return true;

    const res = await this.pool.query<{ permission_key: string }>(
      `SELECT permission_key FROM auth_user_permissions($1) WHERE organization_id = $2`,
      [user.sub, user.organizationId],
    );
    const granted = new Set(res.rows.map((r) => r.permission_key));
    if (!permissions.some((p) => granted.has(p))) {
      throw Errors.forbidden();
    }
    return true;
  }
}
