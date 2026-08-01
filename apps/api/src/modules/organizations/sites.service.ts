import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/organizations.dto';

/** Sites — table tenant sous RLS. Opérations via le contexte tenant. */
@Injectable()
export class SitesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, name_fr, name_ar, phone, address_line1, commune, wilaya,
                authorized_capacity, is_active, created_at
         FROM sites
         WHERE organization_id = $1
         ORDER BY created_at`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getById(id: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, name_fr, name_ar, phone, address_line1, commune, wilaya,
                authorized_capacity, is_active, created_at
         FROM sites WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) throw new AppError('NOT_FOUND', 'Site introuvable', 'الموقع غير موجود', 404);
      return res.rows[0];
    });
  }

  async create(dto: CreateSiteDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const result = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `INSERT INTO sites
           (organization_id, name_fr, name_ar, phone, address_line1, commune, wilaya, authorized_capacity, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name_fr, wilaya, authorized_capacity, created_at`,
        [
          tenantId,
          dto.name_fr,
          dto.name_ar ?? null,
          dto.phone ?? null,
          dto.address_line1 ?? null,
          dto.commune ?? null,
          dto.wilaya ?? null,
          dto.authorized_capacity ?? null,
          actorId,
        ],
      );
      return res.rows[0];
    });

    await this.audit.log({
      organizationId: tenantId,
      userId: actorId,
      action: 'create',
      resourceType: 'site',
      resourceId: result.id,
      resourceLabel: result.name_fr,
      newValues: { wilaya: result.wilaya },
    });
    return result;
  }

  async update(id: string, dto: UpdateSiteDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const result = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE sites SET
           name_fr             = COALESCE($2, name_fr),
           name_ar             = COALESCE($3, name_ar),
           phone               = COALESCE($4, phone),
           authorized_capacity = COALESCE($5, authorized_capacity),
           is_active           = COALESCE($6, is_active),
           updated_at          = NOW()
         WHERE id = $1 AND organization_id = $7
         RETURNING id, name_fr, is_active`,
        [id, dto.name_fr ?? null, dto.name_ar ?? null, dto.phone ?? null,
         dto.authorized_capacity ?? null, dto.is_active ?? null, tenantId],
      );
      if (res.rows.length === 0) throw new AppError('NOT_FOUND', 'Site introuvable', 'الموقع غير موجود', 404);
      return res.rows[0];
    });

    await this.audit.log({
      organizationId: tenantId,
      userId: actorId,
      action: 'update',
      resourceType: 'site',
      resourceId: id,
      resourceLabel: result.name_fr,
      newValues: { ...dto },
    });
    return result;
  }
}
