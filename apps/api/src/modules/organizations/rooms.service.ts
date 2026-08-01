import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { CreateRoomDto, UpdateRoomDto } from './dto/organizations.dto';

/** Salles — table tenant sous RLS. Le CRUD passe par le contexte tenant. */
@Injectable()
export class RoomsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(siteId?: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, site_id, name_fr, name_ar, min_age_months, max_age_months, max_capacity, is_active
         FROM rooms
         WHERE ($1::uuid IS NULL OR site_id = $1)
         ORDER BY name_fr`,
        [siteId ?? null],
      );
      return res.rows;
    });
  }

  /** 404 si la salle n'existe pas OU appartient à un autre tenant (pas de fuite). */
  async getById(id: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, site_id, name_fr, name_ar, min_age_months, max_age_months, max_capacity, is_active
         FROM rooms WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      return res.rows[0];
    });
  }

  async create(dto: CreateRoomDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // Le site doit appartenir au tenant (RLS) — sinon 404 (pas de fuite).
      const site = await client.query(`SELECT id FROM sites WHERE id = $1`, [dto.site_id]);
      if (site.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Site introuvable', 'الموقع غير موجود', 404);
      }
      const res = await client.query(
        `INSERT INTO rooms
           (organization_id, site_id, name_fr, name_ar, min_age_months, max_age_months, max_capacity, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, site_id, name_fr, min_age_months, max_age_months, max_capacity`,
        [
          tenantId,
          dto.site_id,
          dto.name_fr,
          dto.name_ar ?? null,
          dto.min_age_months ?? 3,
          dto.max_age_months ?? 71,
          dto.max_capacity ?? 12,
          actorId,
        ],
      );
      const room = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'room',
        resourceId: room.id,
        resourceLabel: room.name_fr,
        newValues: { site_id: room.site_id, max_capacity: room.max_capacity },
      });
      return room;
    });
  }

  async update(id: string, dto: UpdateRoomDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE rooms SET
           name_fr        = COALESCE($2, name_fr),
           name_ar        = COALESCE($3, name_ar),
           min_age_months = COALESCE($4, min_age_months),
           max_age_months = COALESCE($5, max_age_months),
           max_capacity   = COALESCE($6, max_capacity),
           is_active      = COALESCE($7, is_active),
           updated_at     = NOW()
         WHERE id = $1 AND organization_id = $8
         RETURNING id, site_id, name_fr, is_active`,
        [id, dto.name_fr ?? null, dto.name_ar ?? null, dto.min_age_months ?? null,
         dto.max_age_months ?? null, dto.max_capacity ?? null, dto.is_active ?? null, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      const room = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'room',
        resourceId: id,
        resourceLabel: room.name_fr,
        newValues: { ...dto },
      });
      return room;
    });
  }

  /** Désactivation (soft) — jamais de suppression physique d'une salle. */
  async deactivate(id: string, actorId: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE rooms SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING id, name_fr`,
        [id, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'delete',
        resourceType: 'room',
        resourceId: id,
        resourceLabel: res.rows[0].name_fr,
        newValues: { is_active: false },
      });
    });
  }
}
