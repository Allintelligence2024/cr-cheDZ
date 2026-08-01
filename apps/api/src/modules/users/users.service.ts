import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  role_id: string;
  role_slug: string;
  role_name: string;
  site_id: string | null;
  room_ids: string[] | null;
  joined_at: Date | null;
}

/**
 * Profil de l'utilisateur courant. users = table système (pool direct) ;
 * les memberships sont lues via auth_get_memberships (SECURITY DEFINER,
 * bootstrap auth — même chemin que le login).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantContext: TenantContextService,
  ) {}

  async me(userId: string): Promise<Record<string, unknown>> {
    const userRes = await this.pool.query(
      `SELECT id, email, phone, first_name, last_name, locale, avatar_url,
              status, is_super_admin, last_login_at, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const user = userRes.rows[0];
    if (!user) return { id: userId };

    const membershipsRes = await this.pool.query<MembershipRow>(
      `SELECT * FROM auth_get_memberships($1)`,
      [userId],
    );
    const memberships = membershipsRes.rows;

    // Permissions par rôle (tables système, pool direct)
    const roleIds = memberships.map((m) => m.role_id);
    let permissionsByRole: Record<string, string[]> = {};
    if (roleIds.length > 0) {
      const permsRes = await this.pool.query<{ slug: string; resource: string; action: string }>(
        `SELECT r.slug, p.resource, p.action
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ANY($1::uuid[])`,
        [roleIds],
      );
      permissionsByRole = permsRes.rows.reduce<Record<string, string[]>>((acc, row) => {
        (acc[row.slug] ??= []).push(`${row.resource}:${row.action}`);
        return acc;
      }, {});
    }

    const currentOrgId = this.tenantContext.getTenantIdOrNull();

    return {
      ...user,
      memberships: memberships.map((m) => ({
        organization_id: m.organization_id,
        organization_name: m.organization_name,
        role_slug: m.role_slug,
        role_name: m.role_name,
        site_id: m.site_id,
        room_ids: m.room_ids ?? [],
        joined_at: m.joined_at,
        permissions: permissionsByRole[m.role_slug] ?? [],
      })),
      current_organization_id: currentOrgId,
    };
  }
}
