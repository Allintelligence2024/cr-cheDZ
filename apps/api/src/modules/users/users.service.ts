import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';

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
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Rôles additionnels d'un membre (multi-rôles, migration 040). */
  async listRoleAssignments(userId: string, orgId: string): Promise<Array<Record<string, unknown>>> {
    return this.tenantContext.withTenantConnection(async (client) => {
      // L'utilisateur cible doit être membre du tenant (RLS : la membership
      // n'est visible que dans le tenant courant) — sinon 404.
      const membership = (await client.query(
        `SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND is_active=true`, [orgId, userId],
      )).rows[0];
      if (!membership) throw Errors.notFound();
      return (await client.query(
        `SELECT ra.id, ra.user_id, ra.role_id, r.slug, r.name, ra.created_at
         FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
         WHERE ra.organization_id = $1 AND ra.user_id = $2
         ORDER BY r.slug`, [orgId, userId],
      )).rows;
    });
  }

  /** Ajoute un rôle additionnel — garde : pas de doublon avec le rôle principal. */
  async addRoleAssignment(actorId: string, orgId: string, dto: { user_id: string; role_id: string }): Promise<Record<string, unknown>> {
    return this.tenantContext.withTenantConnection(async (client) => {
      const membership = (await client.query(
        `SELECT role_id FROM memberships WHERE organization_id=$1 AND user_id=$2 AND is_active=true`, [orgId, dto.user_id],
      )).rows[0];
      if (!membership) throw Errors.notFound();
      if (membership.role_id === dto.role_id) {
        throw new AppError('ROLE_ALREADY_PRIMARY', 'Ce rôle est déjà le rôle principal', 'هذا الدور هو الدور الأساسي بالفعل', 409);
      }
      const r = (await client.query(
        `INSERT INTO role_assignments (organization_id, user_id, role_id, assigned_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id, user_id, role_id) DO NOTHING
         RETURNING id, user_id, role_id, created_at`,
        [orgId, dto.user_id, dto.role_id, actorId],
      )).rows[0];
      if (!r) throw new AppError('ROLE_ALREADY_ASSIGNED', 'Rôle déjà assigné', 'الدور معيّن بالفعل', 409);
      await this.audit.log({
        organizationId: orgId,
        userId: actorId,
        action: 'update',
        resourceType: 'role_assignment',
        resourceId: r.id,
        newValues: { user_id: dto.user_id, role_id: dto.role_id },
      });
      return r;
    });
  }

  /** Retire un rôle additionnel (jamais le rôle principal). */
  async removeRoleAssignment(orgId: string, assignmentId: string, actorId: string): Promise<void> {
    await this.tenantContext.withTenantConnection(async (client) => {
      const r = (await client.query(
        `DELETE FROM role_assignments WHERE id=$1 AND organization_id=$2 RETURNING id`,
        [assignmentId, orgId],
      )).rows[0];
      if (!r) throw Errors.notFound();
      await this.audit.log({
        organizationId: orgId,
        userId: actorId,
        action: 'delete',
        resourceType: 'role_assignment',
        resourceId: assignmentId,
      });
    });
  }

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
