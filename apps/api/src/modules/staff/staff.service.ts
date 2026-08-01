import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import {
  CreateStaffAssignmentDto,
  CreateStaffDocumentDto,
  CreateStaffDto,
  StaffAttendanceDto,
  UpdateStaffDto,
} from './dto/staff.dto';

/**
 * Personnel — tables tenant sous RLS. Le salarié doit être membre de
 * l'organisation (membership active) avant de recevoir un profil staff.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ── Profils ──────────────────────────────────────────────────────────────

  async list(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT sp.id, sp.user_id, sp.employee_number, sp.qualification,
                sp.contract_type, sp.hire_date, sp.is_active,
                u.email, COALESCE(u.first_name,'') AS first_name, COALESCE(u.last_name,'') AS last_name,
                (SELECT COUNT(*)::int FROM staff_assignments sa
                  WHERE sa.staff_id = sp.id AND sa.is_active = true) AS active_assignments
         FROM staff_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.organization_id = $1
         ORDER BY sp.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getById(id: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT sp.*, u.email, COALESCE(u.first_name,'') AS first_name, COALESCE(u.last_name,'') AS last_name
         FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1`,
        [id],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      return res.rows[0];
    });
  }

  async create(dto: CreateStaffDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // L'utilisateur doit être membre de l'organisation (RLS scope memberships).
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE user_id = $1 AND is_active = true LIMIT 1`,
        [dto.user_id],
      );
      if (member.rows.length === 0) {
        throw new AppError(
          'USER_NOT_MEMBER',
          'Cet utilisateur n\'est pas membre de l\'organisation',
          'هذا المستخدم ليس عضواً في المؤسسة',
          400,
        );
      }
      const existing = await client.query(
        `SELECT id FROM staff_profiles WHERE user_id = $1 AND organization_id = $2`,
        [dto.user_id, tenantId],
      );
      if (existing.rows.length > 0) {
        throw new AppError('STAFF_EXISTS', 'Ce membre a déjà un profil personnel', 'هذا العضو لديه ملف موظف بالفعل', 409);
      }
      const res = await client.query(
        `INSERT INTO staff_profiles
           (organization_id, user_id, employee_number, national_id, cnas_number,
            qualification, hire_date, contract_type, base_salary, phone,
            emergency_contact_name, emergency_contact_phone, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, user_id, qualification, hire_date, contract_type`,
        [
          tenantId, dto.user_id, dto.employee_number ?? null, dto.national_id ?? null,
          dto.cnas_number ?? null, dto.qualification, dto.hire_date,
          dto.contract_type ?? 'permanent', dto.base_salary ?? null, dto.phone ?? null,
          dto.emergency_contact_name ?? null, dto.emergency_contact_phone ?? null,
          dto.notes ?? null,
        ],
      );
      const staff = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'staff',
        resourceId: staff.id,
        resourceLabel: dto.user_id,
        newValues: { qualification: staff.qualification },
      });
      return staff;
    });
  }

  async update(id: string, dto: UpdateStaffDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE staff_profiles SET
           employee_number = COALESCE($2, employee_number),
           national_id     = COALESCE($3, national_id),
           cnas_number     = COALESCE($4, cnas_number),
           qualification   = COALESCE($5, qualification),
           contract_type   = COALESCE($6, contract_type),
           base_salary     = COALESCE($7, base_salary),
           phone           = COALESCE($8, phone),
           notes           = COALESCE($9, notes),
           is_active       = COALESCE($10, is_active),
           updated_at      = NOW()
         WHERE id = $1 AND organization_id = $11
         RETURNING id, user_id, qualification, is_active`,
        [id, dto.employee_number ?? null, dto.national_id ?? null, dto.cnas_number ?? null,
         dto.qualification ?? null, dto.contract_type ?? null, dto.base_salary ?? null,
         dto.phone ?? null, dto.notes ?? null, dto.is_active ?? null, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'staff',
        resourceId: id,
        newValues: { ...dto },
      });
      return res.rows[0];
    });
  }

  // ── Documents ────────────────────────────────────────────────────────────

  async listDocuments(staffId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, document_type, title, issued_date, expiry_date, issuing_authority, alert_days_before, created_at
         FROM staff_documents WHERE staff_id = $1 ORDER BY created_at DESC`,
        [staffId],
      );
      return res.rows;
    });
  }

  async createDocument(
    staffId: string,
    dto: CreateStaffDocumentDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const staff = await client.query(`SELECT id FROM staff_profiles WHERE id = $1`, [staffId]);
      if (staff.rows.length === 0) throw Errors.notFound();
      const res = await client.query(
        `INSERT INTO staff_documents
           (organization_id, staff_id, document_type, title, storage_key,
            issued_date, expiry_date, issuing_authority, alert_days_before)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, document_type, title, expiry_date`,
        [
          tenantId, staffId, dto.document_type, dto.title, dto.storage_key,
          dto.issued_date ?? null, dto.expiry_date ?? null,
          dto.issuing_authority ?? null, dto.alert_days_before ?? 30,
        ],
      );
      const doc = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'staff_document',
        resourceId: doc.id,
        resourceLabel: doc.title,
        newValues: { document_type: doc.document_type, expiry_date: doc.expiry_date },
      });
      return doc;
    });
  }

  /** Documents expirant sous N jours (alerte). */
  async listExpiringDocuments(days = 30): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT sd.id, sd.staff_id, sd.document_type, sd.title, sd.expiry_date,
                COALESCE(u.first_name,'') AS first_name, COALESCE(u.last_name,'') AS last_name
         FROM staff_documents sd
         JOIN staff_profiles sp ON sp.id = sd.staff_id
         JOIN users u ON u.id = sp.user_id
         WHERE sd.organization_id = $1
           AND sd.expiry_date IS NOT NULL
           AND sd.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int)
         ORDER BY sd.expiry_date`,
        [tenantId, days],
      );
      return res.rows;
    });
  }

  // ── Affectations ─────────────────────────────────────────────────────────

  async listAssignments(staffId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, room_id, site_id, is_primary, start_date, end_date, is_active
         FROM staff_assignments WHERE staff_id = $1 ORDER BY start_date DESC`,
        [staffId],
      );
      return res.rows;
    });
  }

  async createAssignment(
    staffId: string,
    dto: CreateStaffAssignmentDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const staff = await client.query(`SELECT id FROM staff_profiles WHERE id = $1`, [staffId]);
      if (staff.rows.length === 0) throw Errors.notFound();
      const room = await client.query(
        `SELECT id, site_id FROM rooms WHERE id = $1`,
        [dto.room_id],
      );
      if (room.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Salle introuvable', 'القسم غير موجود', 404);
      }
      if (dto.is_primary) {
        // Une seule affectation principale active par membre.
        await client.query(
          `UPDATE staff_assignments SET is_primary = false
           WHERE staff_id = $1 AND is_active = true`,
          [staffId],
        );
      }
      const res = await client.query(
        `INSERT INTO staff_assignments
           (organization_id, staff_id, room_id, site_id, is_primary, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, room_id, site_id, is_primary, start_date, end_date`,
        [
          tenantId, staffId, dto.room_id,
          dto.site_id ?? room.rows[0].site_id,
          dto.is_primary ?? false,
          dto.start_date, dto.end_date ?? null,
        ],
      );
      const assignment = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'staff_assignment',
        resourceId: assignment.id,
        newValues: { staff_id: staffId, room_id: assignment.room_id },
      });
      return assignment;
    });
  }

  async endAssignment(staffId: string, assignmentId: string, actorId: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE staff_assignments SET is_active = false, end_date = COALESCE(end_date, CURRENT_DATE)
         WHERE id = $1 AND staff_id = $2 AND organization_id = $3
         RETURNING id`,
        [assignmentId, staffId, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'staff_assignment',
        resourceId: assignmentId,
        newValues: { is_active: false },
      });
    });
  }

  // ── Pointage ─────────────────────────────────────────────────────────────

  async upsertAttendance(
    staffId: string,
    dto: StaffAttendanceDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const staff = await client.query(`SELECT id FROM staff_profiles WHERE id = $1`, [staffId]);
      if (staff.rows.length === 0) throw Errors.notFound();
      const res = await client.query(
        `INSERT INTO staff_attendance
           (organization_id, staff_id, attendance_date, check_in, check_out, absence_type, notes, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (staff_id, attendance_date) DO UPDATE SET
           check_in    = COALESCE(EXCLUDED.check_in, staff_attendance.check_in),
           check_out   = COALESCE(EXCLUDED.check_out, staff_attendance.check_out),
           absence_type = COALESCE(EXCLUDED.absence_type, staff_attendance.absence_type),
           notes       = COALESCE(EXCLUDED.notes, staff_attendance.notes),
           approved_by = COALESCE(EXCLUDED.approved_by, staff_attendance.approved_by)
         RETURNING id, staff_id, attendance_date, check_in, check_out, absence_type`,
        [
          tenantId, staffId, dto.attendance_date, dto.check_in ?? null, dto.check_out ?? null,
          dto.absence_type ?? null, dto.notes ?? null, actorId,
        ],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'staff_attendance',
        resourceId: res.rows[0].id,
        newValues: { attendance_date: dto.attendance_date },
      });
      return res.rows[0];
    });
  }

  async listAttendance(staffId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, attendance_date, check_in, check_out, absence_type, notes
         FROM staff_attendance WHERE staff_id = $1 ORDER BY attendance_date DESC`,
        [staffId],
      );
      return res.rows;
    });
  }
}
