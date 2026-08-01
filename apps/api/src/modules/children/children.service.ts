import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { CreateChildDto, MoveRoomDto, UpdateChildDto } from './dto/children.dto';

/**
 * Enfants — table tenant sous RLS. Toute opération passe par le contexte
 * tenant ; la lecture d'une fiche est journalisée (carnet d'accès, loi
 * 25-11) car elle contient des données familiales.
 */
@Injectable()
export class ChildrenService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: {
    siteId?: string;
    roomId?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const tenantId = requireTenant(this.tenantContext);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    return this.tenantContext.withTenantConnection(async (client) => {
      const conditions = ['c.deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      if (filters.siteId) {
        params.push(filters.siteId);
        conditions.push(`c.site_id = $${params.length}`);
      }
      if (filters.roomId) {
        params.push(filters.roomId);
        conditions.push(`c.room_id = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`c.status = $${params.length}`);
      }
      if (filters.search) {
        params.push(`%${filters.search}%`);
        conditions.push(
          `(c.first_name_fr ILIKE $${params.length} OR c.last_name_fr ILIKE $${params.length} OR c.reference_number ILIKE $${params.length})`,
        );
      }
      const where = conditions.join(' AND ');

      const totalRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM children c WHERE c.organization_id = $1 AND ${where.replace(/c\./g, 'c.')}`,
        params,
      );
      params.push(limit, offset);
      const itemsRes = await client.query(
        `SELECT c.id, c.reference_number, c.first_name_fr, c.first_name_ar,
                c.last_name_fr, c.last_name_ar, c.date_of_birth, c.gender,
                c.site_id, c.room_id, c.status, c.schedule_type, c.is_walking,
                c.has_special_needs, c.photo_url, c.version
         FROM children c
         WHERE c.organization_id = $1 AND ${where}
         ORDER BY c.last_name_fr, c.first_name_fr
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { items: itemsRes.rows, total: totalRes.rows[0].total };
    });
  }

  /** Détail — journalise l'accès (carnet 25-11) car données familiales. */
  async getById(id: string, actorId: string, actorIp?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const child = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT c.*, r.name_fr AS room_name, s.name_fr AS site_name
         FROM children c
         LEFT JOIN rooms r ON r.id = c.room_id
         LEFT JOIN sites s ON s.id = c.site_id
         WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [id],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      const moves = await client.query(
        `SELECT rm.room_id_from, rm.room_id_to, rm.moved_at, rm.moved_by, rm.reason,
                rf.name_fr AS room_from, rt.name_fr AS room_to
         FROM room_moves rm
         LEFT JOIN rooms rf ON rf.id = rm.room_id_from
         LEFT JOIN rooms rt ON rt.id = rm.room_id_to
         WHERE rm.child_id = $1 ORDER BY rm.moved_at DESC LIMIT 50`,
        [id],
      );
      const statusHistory = await client.query(
        `SELECT csh.status_from, csh.status_to, csh.changed_at, csh.changed_by, csh.reason
         FROM child_status_history csh
         WHERE csh.child_id = $1 ORDER BY csh.changed_at DESC LIMIT 50`,
        [id],
      );
      return { ...res.rows[0], room_moves: moves.rows, status_history: statusHistory.rows };
    });

    await this.audit.logDataAccess({
      organizationId: tenantId,
      userId: actorId,
      dataType: 'child_record',
      dataSubjectId: id,
      dataSubjectType: 'child',
      accessType: 'read',
      justification: 'consultation_fiche',
      ipAddress: actorIp ?? null,
    });
    return child;
  }

  async create(dto: CreateChildDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // Le site doit appartenir au tenant (RLS) — sinon 404.
      const site = await client.query(
        `SELECT s.id, o.slug FROM sites s JOIN organizations o ON o.id = s.organization_id WHERE s.id = $1`,
        [dto.site_id],
      );
      if (site.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Site introuvable', 'الموقع غير موجود', 404);
      }
      if (dto.room_id) {
        const room = await client.query(`SELECT id FROM rooms WHERE id = $1`, [dto.room_id]);
        if (room.rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Salle introuvable', 'القسم غير موجود', 404);
        }
      }

      const seq = await client.query(`SELECT next_org_sequence($1) AS seq`, [tenantId]);
      const year = new Date().getFullYear();
      const prefix = (site.rows[0].slug ?? 'CR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CR';
      const reference = `${prefix}-${year}-${String(seq.rows[0].seq).padStart(5, '0')}`;

      const res = await client.query(
        `INSERT INTO children
           (organization_id, site_id, room_id, reference_number,
            first_name_fr, first_name_ar, last_name_fr, last_name_ar,
            date_of_birth, gender, status, enrollment_date, schedule_type,
            is_walking, has_special_needs, special_needs_notes, notes,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id, reference_number, first_name_fr, last_name_fr, date_of_birth, status, version`,
        [
          tenantId, dto.site_id, dto.room_id ?? null, reference,
          dto.first_name_fr, dto.first_name_ar ?? null, dto.last_name_fr, dto.last_name_ar ?? null,
          dto.date_of_birth, dto.gender ?? null, dto.status ?? 'active', dto.enrollment_date ?? null,
          dto.schedule_type ?? 'full_time', dto.is_walking ?? false,
          dto.has_special_needs ?? false, dto.special_needs_notes ?? null, dto.notes ?? null,
          actorId, actorId,
        ],
      );
      const child = res.rows[0];

      // Historique du statut initial.
      await client.query(
        `INSERT INTO child_status_history (organization_id, child_id, status_to, changed_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, child.id, child.status, actorId],
      );

      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'child',
        resourceId: child.id,
        resourceLabel: `${child.first_name_fr} ${child.last_name_fr}`,
        newValues: { reference_number: child.reference_number, status: child.status },
      });
      return child;
    });
  }

  async update(id: string, dto: UpdateChildDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const before = await client.query(
        `SELECT * FROM children WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (before.rows.length === 0) throw Errors.notFound();
      const old = before.rows[0];

      if (dto.room_id !== undefined) {
        const room = await client.query(`SELECT id FROM rooms WHERE id = $1`, [dto.room_id]);
        if (room.rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Salle introuvable', 'القسم غير موجود', 404);
        }
      }

      const res = await client.query(
        `UPDATE children SET
           room_id              = COALESCE($2, room_id),
           first_name_fr        = COALESCE($3, first_name_fr),
           first_name_ar        = COALESCE($4, first_name_ar),
           last_name_fr         = COALESCE($5, last_name_fr),
           last_name_ar         = COALESCE($6, last_name_ar),
           gender               = COALESCE($7, gender),
           status               = COALESCE($8, status),
           enrollment_date      = COALESCE($9, enrollment_date),
           departure_date       = COALESCE($10, departure_date),
           departure_reason     = COALESCE($11, departure_reason),
           schedule_type        = COALESCE($12, schedule_type),
           is_walking           = COALESCE($13, is_walking),
           has_special_needs    = COALESCE($14, has_special_needs),
           special_needs_notes  = COALESCE($15, special_needs_notes),
           notes                = COALESCE($16, notes),
           updated_by           = $17,
           updated_at           = NOW(),
           version              = version + 1
         WHERE id = $1 AND organization_id = $18
         RETURNING id, status, version`,
        [
          id, dto.room_id ?? null, dto.first_name_fr ?? null, dto.first_name_ar ?? null,
          dto.last_name_fr ?? null, dto.last_name_ar ?? null, dto.gender ?? null,
          dto.status ?? null, dto.enrollment_date ?? null, dto.departure_date ?? null,
          dto.departure_reason ?? null, dto.schedule_type ?? null, dto.is_walking ?? null,
          dto.has_special_needs ?? null, dto.special_needs_notes ?? null, dto.notes ?? null,
          actorId, tenantId,
        ],
      );

      // Historique des changements de statut.
      if (dto.status && dto.status !== old.status) {
        await client.query(
          `INSERT INTO child_status_history (organization_id, child_id, status_from, status_to, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, id, old.status, dto.status, actorId],
        );
      }

      // Tracé du changement de salle (C08) : tout mouvement, quel que soit le chemin.
      if (dto.room_id && dto.room_id !== old.room_id) {
        await client.query(
          `INSERT INTO room_moves (organization_id, child_id, room_id_from, room_id_to, moved_by, reason)
           VALUES ($1, $2, $3, $4, $5, 'update')`,
          [tenantId, id, old.room_id, dto.room_id, actorId],
        );
      }

      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'child',
        resourceId: id,
        resourceLabel: `${old.first_name_fr} ${old.last_name_fr}`,
        oldValues: { status: old.status, room_id: old.room_id },
        newValues: { ...dto },
      });
      return res.rows[0];
    });
  }

  /** Changement de salle tracé (C08). */
  async moveRoom(id: string, dto: MoveRoomDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const child = await client.query(
        `SELECT id, room_id FROM children WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (child.rows.length === 0) throw Errors.notFound();
      const room = await client.query(`SELECT id FROM rooms WHERE id = $1`, [dto.room_id]);
      if (room.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Salle introuvable', 'القسم غير موجود', 404);
      }
      if (child.rows[0].room_id === dto.room_id) {
        return { id, moved: false };
      }

      await client.query(
        `INSERT INTO room_moves (organization_id, child_id, room_id_from, room_id_to, moved_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, id, child.rows[0].room_id, dto.room_id, actorId, dto.reason ?? null],
      );
      const res = await client.query(
        `UPDATE children SET room_id = $2, updated_by = $3, version = version + 1
         WHERE id = $1 RETURNING id, room_id, version`,
        [id, dto.room_id, actorId],
      );

      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'child',
        resourceId: id,
        newValues: { room_id_from: child.rows[0].room_id, room_id_to: dto.room_id },
      });
      return { ...res.rows[0], moved: true };
    });
  }

  /** Soft delete : statut departed + deleted_at (jamais de purge physique). */
  async softDelete(id: string, actorId: string, reason?: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const before = await client.query(
        `SELECT * FROM children WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (before.rows.length === 0) throw Errors.notFound();
      const old = before.rows[0];

      await client.query(
        `UPDATE children SET
           status = 'departed', departure_date = COALESCE(departure_date, CURRENT_DATE),
           departure_reason = COALESCE($2, departure_reason),
           deleted_at = NOW(), updated_by = $3, updated_at = NOW(), version = version + 1
         WHERE id = $1`,
        [id, reason ?? null, actorId],
      );
      await client.query(
        `INSERT INTO child_status_history (organization_id, child_id, status_from, status_to, changed_by, reason)
         VALUES ($1, $2, $3, 'departed', $4, $5)`,
        [tenantId, id, old.status, actorId, reason ?? 'soft_delete'],
      );

      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'delete',
        resourceType: 'child',
        resourceId: id,
        resourceLabel: `${old.first_name_fr} ${old.last_name_fr}`,
        oldValues: { status: old.status },
        newValues: { status: 'departed', deleted_at: new Date().toISOString() },
      });
    });
  }
}
