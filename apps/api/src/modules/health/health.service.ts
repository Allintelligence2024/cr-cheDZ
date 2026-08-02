import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';

/**
 * Santé (Phase 10) — dossier médical, allergies, vaccinations, autorisations
 * et administrations de médicaments.
 *
 * Données sensibles (loi 25-11) :
 * - toute lecture journalisée (data_access_logs) ;
 * - l'accès parent est verrouillé par child_guardians.can_view_health ;
 * - administration en double saisie : qui donne / qui confirme (2 personnes
 *   différentes) ;
 * - autorisation de médicament : consentement d'un gardien requis, plage de
 *   dates respectée.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ── Lecture du dossier (journalisée) ─────────────────────────────────────

  async getRecord(childId: string, actorId: string, actorIp?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const data = await this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const record = (await client.query(
        `SELECT * FROM health_records WHERE child_id = $1`, [childId],
      )).rows[0] ?? null;
      const allergies = (await client.query(
        `SELECT id, allergen, allergen_type, severity, reaction, treatment,
                emergency_protocol, confirmed_by_doctor, diagnosed_date, notes, is_active
         FROM allergies WHERE child_id = $1 ORDER BY created_at DESC`, [childId],
      )).rows;
      const vaccinations = (await client.query(
        `SELECT id, vaccine_name, dose_number, administered_date, next_dose_date,
                administered_by, lot_number, verified
         FROM vaccinations WHERE child_id = $1 ORDER BY administered_date NULLS LAST, created_at`, [childId],
      )).rows;
      const authorizations = (await client.query(
        `SELECT ma.id, ma.medication_name, ma.dosage, ma.frequency, ma.administration_times,
                ma.start_date, ma.end_date, ma.special_instructions, ma.is_active,
                ma.verified_at, g.first_name_fr AS guardian_first_name, g.last_name_fr AS guardian_last_name
         FROM medication_authorizations ma
         JOIN guardians g ON g.id = ma.guardian_id
         WHERE ma.child_id = $1 ORDER BY ma.created_at DESC`, [childId],
      )).rows;
      const administrations = (await client.query(
        `SELECT ma.id, ma.authorization_id, ma.administered_at, ma.dose_given, ma.observations,
                ma.confirmed_by, ma.parent_notified,
                u.first_name AS administered_by_name
         FROM medication_administrations ma
         JOIN users u ON u.id = ma.administered_by
         WHERE ma.child_id = $1 ORDER BY ma.administered_at DESC LIMIT 50`, [childId],
      )).rows;
      return { record, allergies, vaccinations, medication_authorizations: authorizations, medication_administrations: administrations };
    });

    await this.audit.logDataAccess({
      organizationId: tenantId,
      userId: actorId,
      dataType: 'health_record',
      dataSubjectId: childId,
      dataSubjectType: 'child',
      accessType: 'read',
      justification: 'consultation_dossier_medical',
      ipAddress: actorIp ?? null,
    });
    return data;
  }

  async upsertRecord(childId: string, dto: any, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const r = await client.query(
        `INSERT INTO health_records (organization_id, child_id, blood_type, family_doctor,
           doctor_phone, health_insurance, chronic_conditions, general_notes, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (child_id) DO UPDATE SET
           blood_type = EXCLUDED.blood_type,
           family_doctor = EXCLUDED.family_doctor,
           doctor_phone = EXCLUDED.doctor_phone,
           health_insurance = EXCLUDED.health_insurance,
           chronic_conditions = EXCLUDED.chronic_conditions,
           general_notes = EXCLUDED.general_notes,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW(),
           version = health_records.version + 1
         RETURNING *`,
        [tenantId, childId, dto.blood_type ?? null, dto.family_doctor ?? null, dto.doctor_phone ?? null,
         dto.health_insurance ?? null, dto.chronic_conditions ?? null, dto.general_notes ?? null, actorId],
      );
      return r.rows[0];
    });
  }

  // ── Allergies ─────────────────────────────────────────────────────────────

  async createAllergy(childId: string, dto: any, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const r = await client.query(
        `INSERT INTO allergies (organization_id, child_id, allergen, allergen_type, severity,
           reaction, treatment, emergency_protocol, confirmed_by_doctor, diagnosed_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, allergen, allergen_type, severity, is_active`,
        [tenantId, childId, dto.allergen, dto.allergen_type, dto.severity,
         dto.reaction ?? null, dto.treatment ?? null, dto.emergency_protocol ?? null,
         dto.confirmed_by_doctor ?? false, dto.diagnosed_date ?? null, dto.notes ?? null, actorId],
      );
      return r.rows[0];
    });
  }

  async updateAllergy(allergyId: string, dto: any): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM allergies WHERE id=$1`, [allergyId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE allergies SET allergen=COALESCE($2, allergen), allergen_type=COALESCE($3, allergen_type),
           severity=COALESCE($4, severity), is_active=COALESCE($5, is_active),
           updated_at=NOW(), version=version+1
         WHERE id=$1 RETURNING id, allergen, allergen_type, severity, is_active`,
        [allergyId, dto.allergen ?? null, dto.allergen_type ?? null, dto.severity ?? null, dto.is_active ?? null],
      );
      return r.rows[0];
    });
  }

  // ── Vaccinations ──────────────────────────────────────────────────────────

  async createVaccination(childId: string, dto: any): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const r = await client.query(
        `INSERT INTO vaccinations (organization_id, child_id, vaccine_name, dose_number,
           administered_date, next_dose_date, administered_by, lot_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, vaccine_name, dose_number, administered_date, next_dose_date, verified`,
        [tenantId, childId, dto.vaccine_name, dto.dose_number ?? null,
         dto.administered_date ?? null, dto.next_dose_date ?? null,
         dto.administered_by ?? null, dto.lot_number ?? null],
      );
      return r.rows[0];
    });
  }

  async updateVaccination(vaccinationId: string, dto: any, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM vaccinations WHERE id=$1`, [vaccinationId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE vaccinations
           SET next_dose_date = COALESCE($2, next_dose_date),
               verified = COALESCE($3, verified),
               verified_by = CASE WHEN $3 THEN $4 ELSE verified_by END
         WHERE id=$1 RETURNING id, vaccine_name, next_dose_date, verified`,
        [vaccinationId, dto.next_dose_date ?? null, dto.verified ?? null, actorId],
      );
      return r.rows[0];
    });
  }

  // ── Autorisations de médicaments (consentement gardien) ───────────────────

  async createMedicationAuthorization(childId: string, dto: any): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const guardian = (await client.query(
        `SELECT g.id FROM guardians g
         JOIN child_guardians cg ON cg.guardian_id = g.id
         WHERE g.id = $1 AND cg.child_id = $2`, [dto.guardian_id, childId],
      )).rows[0];
      if (!guardian) {
        throw new AppError('GUARDIAN_NOT_LINKED', 'Le gardien n’est pas lié à cet enfant', 'ولي الأمر غير مرتبط بهذا الطفل', 422);
      }
      const r = await client.query(
        `INSERT INTO medication_authorizations (organization_id, child_id, guardian_id,
           medication_name, dosage, frequency, administration_times, start_date, end_date,
           special_instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, medication_name, dosage, frequency, start_date, end_date, is_active`,
        [tenantId, childId, dto.guardian_id, dto.medication_name, dto.dosage, dto.frequency,
         dto.administration_times ?? null, dto.start_date, dto.end_date ?? null,
         dto.special_instructions ?? null],
      );
      return r.rows[0];
    });
  }

  async verifyMedicationAuthorization(authId: string, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM medication_authorizations WHERE id=$1`, [authId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE medication_authorizations SET verified_by=$2, verified_at=NOW() WHERE id=$1
         RETURNING id, medication_name, verified_at`, [authId, actorId],
      );
      return r.rows[0];
    });
  }

  // ── Administrations (double saisie) ───────────────────────────────────────

  async recordAdministration(childId: string, dto: any, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const auth = (await client.query(
        `SELECT id, child_id, start_date, end_date, is_active, medication_name
         FROM medication_authorizations WHERE id = $1`, [dto.authorization_id],
      )).rows[0];
      if (!auth) throw Errors.notFound();
      if (!auth.is_active) {
        throw new AppError('MEDICATION_AUTH_INACTIVE', 'Autorisation de médicament inactive', 'تفويض الدواء غير نشط', 422);
      }
      if (auth.child_id !== childId) {
        throw new AppError('MEDICATION_AUTH_MISMATCH', 'L’autorisation ne concerne pas cet enfant', 'التفويض لا يخص هذا الطفل', 422);
      }
      // node-postgres renvoie les DATE comme objets Date → format ISO explicite.
      const fmt = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
      const day = fmt(dto.administered_at);
      if (day < fmt(auth.start_date) || (auth.end_date && day > fmt(auth.end_date))) {
        throw new AppError('MEDICATION_OUTSIDE_AUTH', 'Administration hors de la période autorisée', 'الإعطاء خارج الفترة المصرح بها', 422);
      }
      const r = await client.query(
        `INSERT INTO medication_administrations (organization_id, authorization_id, child_id,
           administered_at, administered_by, dose_given, observations)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, administered_at, dose_given, confirmed_by, parent_notified`,
        [tenantId, dto.authorization_id, childId, dto.administered_at, actorId, dto.dose_given, dto.observations ?? null],
      );
      return r.rows[0];
    });
  }

  async confirmAdministration(adminId: string, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const admin = (await client.query(
        `SELECT id, administered_by, confirmed_by FROM medication_administrations WHERE id=$1`, [adminId],
      )).rows[0];
      if (!admin) throw Errors.notFound();
      if (admin.confirmed_by) {
        throw new AppError('MEDICATION_ALREADY_CONFIRMED', 'Administration déjà confirmée', 'تم تأكيد الإعطاء مسبقاً', 409);
      }
      if (admin.administered_by === actorId) {
        throw new AppError('MEDICATION_CONFIRM_SAME_USER', 'La confirmation doit être faite par une autre personne', 'يجب أن يؤكد شخص آخر', 422);
      }
      const r = await client.query(
        `UPDATE medication_administrations SET confirmed_by=$2 WHERE id=$1
         RETURNING id, administered_at, dose_given, administered_by, confirmed_by`,
        [adminId, actorId],
      );
      return r.rows[0];
    });
  }

  private async childOfTenant(client: import('pg').PoolClient, childId: string): Promise<void> {
    const res = await client.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`, [childId]);
    if (res.rows.length === 0) throw Errors.notFound();
  }
}
