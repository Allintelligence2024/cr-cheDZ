import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from './audit.service';

/**
 * Vie privée (loi 18-07 modifiée par 25-11) + console support.
 *
 * - Demandes de droits (accès/rectification/opposition) avec deadline 30 j ;
 * - export JSON des données d'un enfant (droit d'accès) persisté dans
 *   privacy_request_exports ;
 * - workflow de violation : chrono de notification ANPDP sous 5 jours ;
 *   l'envoi réel passe par SMTP (nodemailer) — sans configuration, erreur
 *   503 explicite (jamais de faux « notifié ») ;
 * - DPIA (analyses d'impact) liées au registre des traitements ;
 * - console support : recherche globale cross-tenant, impersonation auditée,
 *   monitoring/retry des jobs (fonctions SECURITY DEFINER, migration 029).
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // ── Registre des traitements (DPO) ────────────────────────────────────────

  async registry(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT id, processing_name, purpose_fr, purpose_ar, legal_basis, data_categories,
              data_subjects, retention_days, third_parties, security_measures, is_active
       FROM processing_registry
       WHERE organization_id = $1 OR organization_id IS NULL
       ORDER BY organization_id NULLS FIRST, processing_name`, [tenantId],
    )).rows);
  }

  // ── Demandes de droits ────────────────────────────────────────────────────

  async createRequest(userId: string, role: string, dto: { request_type: string; subject_id?: string; notes?: string }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // Un parent ne peut demander que pour un enfant dont il est gardien ;
      // la directrice/le super_admin pour n'importe quel enfant du tenant.
      if (dto.subject_id) {
        const linked = await client.query(
          `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
           WHERE cg.child_id = $1 AND g.user_id = $2`,
          [dto.subject_id, userId],
        );
        const isStaff = role === 'director' || role === 'super_admin' || role === 'accountant';
        if (!linked.rows[0] && !isStaff) {
          throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’êtes pas responsable de cet enfant', 'لست ولي أمر هذا الطفل', 403);
        }
        const child = await client.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`, [dto.subject_id]);
        if (!child.rows[0]) throw Errors.notFound();
      }
      const r = await client.query(
        `INSERT INTO privacy_requests (organization_id, requester_id, request_type, subject_id, notes, deadline)
         VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '30 days') RETURNING *`,
        [tenantId, userId, dto.request_type, dto.subject_id ?? null, dto.notes ?? null],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'privacy_request',
        resourceId: r.rows[0].id,
        newValues: { request_type: dto.request_type, subject_id: dto.subject_id ?? null },
      });
      return r.rows[0];
    });
  }

  async listRequests(userId: string, role: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    const isStaff = role === 'director' || role === 'super_admin' || role === 'accountant';
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT pr.id, pr.requester_id, pr.request_type, pr.subject_id, pr.status, pr.notes,
                pr.deadline, pr.resolved_at, pr.created_at, u.email AS requester_email
         FROM privacy_requests pr JOIN users u ON u.id = pr.requester_id
         WHERE pr.organization_id = $1 ${isStaff ? '' : 'AND pr.requester_id = $2'}
         ORDER BY pr.created_at DESC LIMIT 100`,
        isStaff ? [tenantId] : [tenantId, userId],
      );
      return res.rows;
    });
  }

  async getRequest(requestId: string, userId: string, role: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    const isStaff = role === 'director' || role === 'super_admin' || role === 'accountant';
    return this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT * FROM privacy_requests WHERE id=$1 ${isStaff ? '' : 'AND requester_id=$2'}`,
        isStaff ? [requestId] : [requestId, userId],
      );
      if (!r.rows[0]) throw Errors.notFound();
      return r.rows[0];
    });
  }

  /** Droit d'accès : génère l'export JSON complet des données de l'enfant. */
  async exportRequest(requestId: string, userId: string, role: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const isStaff = role === 'director' || role === 'super_admin' || role === 'accountant';
    const exportRow = await this.tenantContext.withTenantConnection(async (client) => {
      const request = (await client.query(
        `SELECT * FROM privacy_requests WHERE id=$1 ${isStaff ? '' : 'AND requester_id=$2'}`,
        isStaff ? [requestId] : [requestId, userId],
      )).rows[0];
      if (!request) throw Errors.notFound();
      if (!request.subject_id) throw new AppError('EXPORT_NO_SUBJECT', 'La demande ne cible aucun enfant', 'الطلب لا يخص أي طفل', 422);
      const childId = request.subject_id as string;

      const child = (await client.query(`SELECT * FROM children WHERE id=$1`, [childId])).rows[0] ?? null;
      const health = (await client.query(`SELECT * FROM health_records WHERE child_id=$1`, [childId])).rows[0] ?? null;
      const allergies = (await client.query(
        `SELECT allergen, allergen_type, severity, reaction, treatment, emergency_protocol, confirmed_by_doctor, diagnosed_date, notes, is_active
         FROM allergies WHERE child_id=$1 ORDER BY created_at`, [childId],
      )).rows;
      const vaccinations = (await client.query(
        `SELECT vaccine_name, dose_number, administered_date, next_dose_date, lot_number, verified
         FROM vaccinations WHERE child_id=$1 ORDER BY administered_date NULLS LAST`, [childId],
      )).rows;
      const medAuths = (await client.query(
        `SELECT medication_name, dosage, frequency, start_date, end_date, is_active FROM medication_authorizations WHERE child_id=$1`, [childId],
      )).rows;
      const medAdmins = (await client.query(
        `SELECT administered_at, dose_given, observations, (confirmed_by IS NOT NULL) AS confirmed FROM medication_administrations WHERE child_id=$1 ORDER BY administered_at`, [childId],
      )).rows;
      const journal = (await client.query(
        `SELECT event_type, occurred_at, meal_type, meal_quantity, meal_notes, nap_start_at, nap_end_at,
                nap_quality, diaper_type, temperature_celsius, health_observation, activity_name,
                activity_notes, note_text, note_is_private, incident_severity, incident_description,
                is_correction, visible_to_parents
         FROM daily_log_events WHERE child_id=$1 ORDER BY occurred_at`, [childId],
      )).rows;
      const attendance = (await client.query(
        `SELECT s.session_date, s.status, e.event_type, e.occurred_at
         FROM attendance_sessions s LEFT JOIN attendance_events e ON e.session_id = s.id
         WHERE s.child_id=$1 ORDER BY s.session_date, e.occurred_at`, [childId],
      )).rows;
      const invoices = (await client.query(
        `SELECT invoice_number, period_year, period_month, subtotal, discount_amount, total_amount, paid_amount, status, due_date, created_at
         FROM invoices WHERE child_id=$1 ORDER BY created_at`, [childId],
      )).rows;
      const payments = (await client.query(
        `SELECT reference_number, amount, method, status, received_at, confirmed_at FROM payments WHERE child_id=$1 ORDER BY created_at`, [childId],
      )).rows;
      const consents = (await client.query(
        `SELECT consent_type, granted, granted_at, revoked_at, collection_method, created_at
         FROM consent_records WHERE child_id=$1 ORDER BY created_at`, [childId],
      )).rows;

      const payload = {
        generated_at: new Date().toISOString(),
        child,
        health_record: health,
        allergies,
        vaccinations,
        medication_authorizations: medAuths,
        medication_administrations: medAdmins,
        journal_events: journal,
        attendance: attendance,
        invoices,
        payments,
        consents,
      };
      const inserted = (await client.query(
        `INSERT INTO privacy_request_exports (organization_id, request_id, payload, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
        [tenantId, requestId, JSON.stringify(payload), userId],
      )).rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'export',
        resourceType: 'privacy_request',
        resourceId: requestId,
        newValues: { export_id: inserted.id, data_categories: Object.keys(payload).filter((k) => k !== 'generated_at') },
      });
      return { export_id: inserted.id, created_at: inserted.created_at, payload };
    });
    return exportRow;
  }

  async resolveRequest(requestId: string, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM privacy_requests WHERE id=$1`, [requestId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE privacy_requests SET status='resolved', resolved_by=$2, resolved_at=NOW() WHERE id=$1
         RETURNING id, status, resolved_at`, [requestId, actorId],
      );
      return r.rows[0];
    });
  }

  // ── Violations de données (chrono 5 jours ANPDP) ──────────────────────────

  async createViolation(userId: string, dto: { description: string; data_categories?: string[]; affected_subjects?: number; severity?: string; occurred_at?: string }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `INSERT INTO privacy_violations (organization_id, description, data_categories, affected_subjects,
           severity, occurred_at, notification_deadline, created_by)
         VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '5 days', $7) RETURNING *`,
        [tenantId, dto.description, dto.data_categories ?? [], dto.affected_subjects ?? 0,
         dto.severity ?? 'moderate', dto.occurred_at ?? null, userId],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'privacy_violation',
        resourceId: r.rows[0].id,
        newValues: { severity: r.rows[0].severity, deadline: r.rows[0].notification_deadline },
      });
      return r.rows[0];
    });
  }

  async listViolations(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT id, description, data_categories, affected_subjects, severity, status,
              discovered_at, occurred_at, notification_deadline, anpdp_notified_at,
              notification_status, dpo_notes, created_at
       FROM privacy_violations WHERE organization_id=$1 ORDER BY created_at DESC`, [tenantId],
    )).rows);
  }

  /** Notification ANPDP : SMTP réel requis — sinon 503 explicite (jamais de faux). */
  async notifyAnpdp(violationId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    const violation = await this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT * FROM privacy_violations WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [violationId, tenantId],
      );
      if (!r.rows[0]) throw Errors.notFound();
      if (r.rows[0].anpdp_notified_at) {
        throw new AppError('VIOLATION_ALREADY_NOTIFIED', 'Violation déjà notifiée', 'تم إبلاغ الانتهاك مسبقاً', 409);
      }
      return r.rows[0];
    });
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      throw new AppError(
        'VIOLATION_NOTIFY_NOT_CONFIGURED',
        'La notification ANPDP par email n’est pas configurée (SMTP_HOST manquant)',
        'لم يتم تكوين إشعار ANPDP عبر البريد الإلكتروني (نقص SMTP_HOST)',
        503,
      );
    }
    // Envoi SMTP réel via nodemailer (SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_TO).
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({
      host,
      port: Number(this.config.get<string>('SMTP_PORT', '587')),
      secure: this.config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: this.config.get<string>('SMTP_USER')
        ? { user: this.config.get<string>('SMTP_USER')!, pass: this.config.get<string>('SMTP_PASS') ?? '' }
        : undefined,
    });
    const to = this.config.get<string>('SMTP_TO');
    if (!to) throw new AppError('VIOLATION_NOTIFY_NOT_CONFIGURED', 'Destinataire SMTP_TO manquant', 'مستلم SMTP_TO مفقود', 503);
    await transporter.sendMail({
      from: this.config.get<string>('SMTP_FROM', this.config.get<string>('SMTP_USER') ?? 'dpo@creche.local'),
      to,
      subject: `[Violation 25-11] ${String(violation.severity).toUpperCase()} — ${String(violation.id).slice(0, 8)}`,
      text: `Violation de données signalée le ${new Date(violation.discovered_at).toISOString()}.\nDescription : ${violation.description}\nÉchéance de notification ANPDP : ${new Date(violation.notification_deadline).toISOString()}`,
    });
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `UPDATE privacy_violations SET anpdp_notified_at=NOW(), notification_status='sent' WHERE id=$1
       RETURNING id, status, notification_status, anpdp_notified_at`, [violationId],
    )).rows[0]);
  }

  // ── DPIA / AIPD ───────────────────────────────────────────────────────────

  async listDpias(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT d.id, d.processing_registry_id, d.status, d.risk_assessment, d.mitigation_measures,
              d.approved_at, d.review_date, d.created_at, p.processing_name
       FROM privacy_dpias d JOIN processing_registry p ON p.id = d.processing_registry_id
       WHERE d.organization_id=$1 ORDER BY d.created_at DESC`, [tenantId],
    )).rows);
  }

  async createDpia(userId: string, dto: { processing_registry_id: string; risk_assessment?: Record<string, unknown>; mitigation_measures?: string[] }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const proc = (await client.query(`SELECT id FROM processing_registry WHERE id=$1`, [dto.processing_registry_id])).rows[0];
      if (!proc) throw Errors.notFound();
      const r = await client.query(
        `INSERT INTO privacy_dpias (organization_id, processing_registry_id, risk_assessment, mitigation_measures, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, status, created_at`,
        [tenantId, dto.processing_registry_id, JSON.stringify(dto.risk_assessment ?? {}), dto.mitigation_measures ?? [], userId],
      );
      return r.rows[0];
    });
  }

  async approveDpia(dpiaId: string, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM privacy_dpias WHERE id=$1`, [dpiaId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE privacy_dpias SET status='approved', approved_by=$2, approved_at=NOW(), review_date=CURRENT_DATE + 365
         WHERE id=$1 RETURNING id, status, approved_at`, [dpiaId, actorId],
      );
      return r.rows[0];
    });
  }

  // ── Console support (super_admin) ─────────────────────────────────────────

  async globalSearch(query: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(`SELECT * FROM support_global_search($1)`, [query]);
    return r.rows;
  }

  /** Impersonation auditée : token signé pour l'utilisateur cible + entrée d'audit. */
  async impersonate(actorId: string, dto: { user_id: string; reason: string }): Promise<{ access_token: string; expires_in: number }> {
    const res = await this.pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_super_admin, u.status
       FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [dto.user_id],
    );
    const user = res.rows[0];
    if (!user) throw Errors.notFound();
    if (user.status !== 'active') {
      throw new AppError('USER_NOT_ACTIVE', 'L’utilisateur cible n’est pas actif', 'المستخدم المستهدف غير نشط', 422);
    }
    const membership = (await this.pool.query(`SELECT * FROM auth_get_memberships($1)`, [user.id])).rows[0] ?? null;
    const role = user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none');
    const accessToken = this.jwt.sign({
      sub: user.id,
      organizationId: membership?.organization_id ?? null,
      role,
      isSuperAdmin: user.is_super_admin,
      email: user.email,
    });
    await this.audit.log({
      userId: actorId,
      action: 'impersonate',
      resourceType: 'user',
      resourceId: user.id,
      resourceLabel: user.email ?? undefined,
      newValues: { reason: dto.reason, organization_id: membership?.organization_id ?? null },
    });
    return { access_token: accessToken, expires_in: 15 * 60 };
  }

  async listJobs(): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(`SELECT * FROM support_list_jobs(100)`);
    return r.rows;
  }

  async retryJob(jobId: string, actorId: string): Promise<Record<string, unknown>> {
    try {
      await this.pool.query(`SELECT support_retry_job($1)`, [jobId]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('JOB_NOT_RETRYABLE')) {
        throw new AppError('JOB_NOT_RETRYABLE', 'Job non relançable (absent ou en cours)', 'لا يمكن إعادة تشغيل المهمة', 422);
      }
      throw error;
    }
    await this.audit.log({
      userId: actorId,
      action: 'update',
      resourceType: 'background_job',
      resourceId: jobId,
      newValues: { retry: true },
    });
    return { id: jobId, retried: true };
  }

  /** Feature flags (support) : liste complète cross-tenant. */
  async listFlags(): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(`SELECT * FROM support_list_flags()`);
    return r.rows;
  }

  /** Feature flags (support) : activer/désactiver un flag global ou une surcharge org. */
  async setFlag(flagKey: string, dto: { organization_id?: string; is_enabled: boolean }, actorId: string): Promise<Record<string, unknown>> {
    await this.pool.query(`SELECT support_set_flag($1, $2, $3)`, [flagKey, dto.organization_id ?? null, dto.is_enabled]);
    await this.audit.log({
      userId: actorId,
      action: 'update',
      resourceType: 'feature_flag',
      resourceLabel: flagKey,
      newValues: { organization_id: dto.organization_id ?? null, is_enabled: dto.is_enabled },
    });
    return { flag_key: flagKey, organization_id: dto.organization_id ?? null, is_enabled: dto.is_enabled };
  }

  /** Suivi pilote (Phase 12) : agrégats par organisation (super_admin). */
  async pilotSummary(): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(`SELECT * FROM support_pilot_summary()`);
    return r.rows;
  }
}
