import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { buildAttestationPdf } from './attestation-pdf';

/**
 * Attestations annuelles de frais de garde (P2-6, migration 069).
 *
 * Émission = photo figée : montants facturés/réglés (factures non annulées de
 * l'année civile, hors brouillons), nombre de jours de présence, période
 * réelle d'accueil (première/dernière présence de l'année). Le PDF est
 * régénéré à la demande depuis cette photo (déterministe), jamais depuis les
 * données vivantes. Le parent facturable (can_receive_invoices) peut lister et
 * télécharger ses propres attestations ; le personnel émet.
 */
@Injectable()
export class AttestationsService {
  constructor(private readonly tenant: TenantContextService, private readonly audit: AuditService) {}

  async issue(userId: string, dto: { child_id: string; year: number }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const child = (await c.query(`SELECT id FROM children WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [dto.child_id, org])).rows[0];
      if (!child) throw Errors.notFound();
      const fin = (await c.query(
        `SELECT COALESCE(SUM(total_amount),0) AS invoiced, COALESCE(SUM(paid_amount),0) AS paid, COUNT(*)::int AS n
         FROM invoices WHERE organization_id=$1 AND child_id=$2 AND period_year=$3 AND status NOT IN ('draft','cancelled')`,
        [org, dto.child_id, dto.year],
      )).rows[0];
      const att = (await c.query(
        `SELECT COUNT(*)::int AS days, MIN(session_date)::text AS first_day, MAX(session_date)::text AS last_day
         FROM attendance_sessions WHERE organization_id=$1 AND child_id=$2 AND status IN ('present','departed')
           AND session_date BETWEEN make_date($3,1,1) AND make_date($3,12,31)`,
        [org, dto.child_id, dto.year],
      )).rows[0];
      if (fin.n === 0 && att.days === 0) {
        throw new AppError('ATTESTATION_EMPTY', `Aucune facture ni présence pour cet enfant en ${dto.year}`, 'لا توجد فواتير ولا حضور لهذا الطفل في هذه السنة', 422);
      }
      const guardian = (await c.query(
        `SELECT g.id FROM guardians g JOIN child_guardians cg ON cg.guardian_id=g.id AND cg.organization_id=g.organization_id
         WHERE cg.child_id=$1 AND cg.organization_id=$2 AND g.deleted_at IS NULL
         ORDER BY cg.can_receive_invoices DESC, cg.is_primary DESC, g.created_at LIMIT 1`, [dto.child_id, org],
      )).rows[0];
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const row = (await c.query(
        `INSERT INTO attestations(organization_id, child_id, attestation_number, year, total_invoiced, total_paid, invoice_count, days_present, period_start, period_end, guardian_id, issued_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, attestation_number, year, total_invoiced, total_paid, invoice_count, days_present, period_start::text, period_end::text, guardian_id, issued_at`,
        [org, dto.child_id, `ATT-${dto.year}-${seq}`, dto.year, fin.invoiced, fin.paid, fin.n, att.days, att.first_day, att.last_day, guardian?.id ?? null, userId],
      )).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'attestation', resourceId: row.id, resourceLabel: row.attestation_number, newValues: { child_id: dto.child_id, year: dto.year } });
      return row;
    });
  }

  async list(childId?: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (childId) { params.push(childId); where = ' AND a.child_id=$2'; }
      return (await c.query(
        `SELECT a.id, a.attestation_number, a.child_id, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name,
                a.year, a.total_invoiced, a.total_paid, a.invoice_count, a.days_present, a.period_start::text, a.period_end::text, a.issued_at
         FROM attestations a JOIN children ch ON ch.id=a.child_id
         WHERE a.organization_id=$1${where} ORDER BY a.issued_at DESC`, params,
      )).rows;
    });
  }

  /** Parent : uniquement les attestations des enfants pour lesquels il est facturable. */
  async listForParent(userId: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => (await c.query(
      `SELECT a.id, a.attestation_number, a.child_id, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name,
              a.year, a.total_invoiced, a.total_paid, a.invoice_count, a.days_present, a.period_start::text, a.period_end::text, a.issued_at
       FROM attestations a JOIN children ch ON ch.id=a.child_id
       WHERE a.organization_id=$1 AND EXISTS (
         SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id=cg.guardian_id
         WHERE cg.child_id=a.child_id AND cg.organization_id=$1 AND g.user_id=$2 AND g.deleted_at IS NULL AND cg.can_receive_invoices=true)
       ORDER BY a.issued_at DESC`, [org, userId],
    )).rows);
  }

  /** PDF (personnel, ou parent facturable si `parentUserId`). Accès journalisé. */
  async pdf(userId: string, attestationId: string, opts: { parentUserId?: string; ipAddress?: string } = {}) {
    const org = requireTenant(this.tenant);
    const data = await this.tenant.withTenantConnection(async (c) => {
      const a = (await c.query(
        `SELECT a.*, a.period_start::text AS period_start, a.period_end::text AS period_end, ch.first_name_fr, ch.last_name_fr, ch.date_of_birth::text AS dob,
                o.name_fr AS org_name, o.legal_name, o.registration_number,
                concat_ws(', ', o.address_line1, o.address_line2, o.wilaya) AS org_address,
                g.first_name_fr AS g_first, g.last_name_fr AS g_last
         FROM attestations a JOIN children ch ON ch.id=a.child_id JOIN organizations o ON o.id=a.organization_id
         LEFT JOIN guardians g ON g.id=a.guardian_id
         WHERE a.id=$1 AND a.organization_id=$2`, [attestationId, org],
      )).rows[0];
      if (!a) throw Errors.notFound();
      if (opts.parentUserId) {
        const allowed = await c.query(
          `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id=cg.guardian_id
           WHERE cg.child_id=$1 AND cg.organization_id=$2 AND g.user_id=$3 AND g.deleted_at IS NULL AND cg.can_receive_invoices=true`,
          [a.child_id, org, opts.parentUserId],
        );
        if (!allowed.rows[0]) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour cette attestation', 'ليس لديك صلاحية لهذه الشهادة', 403);
      }
      return a;
    });
    await this.audit.logDataAccess({
      organizationId: org, userId, dataType: 'attestation_pdf', dataSubjectId: data.child_id, dataSubjectType: 'child',
      accessType: 'view', justification: opts.parentUserId ? 'consultation_attestation_parent' : 'emission_attestation', ipAddress: opts.ipAddress ?? null,
    });
    const buffer = await buildAttestationPdf({
      orgName: data.org_name, orgLegalName: data.legal_name, orgAddress: data.org_address || null, orgRegistration: data.registration_number,
      attestationNumber: data.attestation_number, year: data.year,
      childName: `${data.first_name_fr} ${data.last_name_fr}`.trim(), childBirthDate: data.dob,
      guardianName: data.g_first ? `${data.g_first} ${data.g_last}`.trim() : 'la famille',
      totalInvoiced: Number(data.total_invoiced), totalPaid: Number(data.total_paid), invoiceCount: data.invoice_count, daysPresent: data.days_present,
      periodStart: data.period_start ? String(data.period_start) : null, periodEnd: data.period_end ? String(data.period_end) : null,
      issuedAt: new Date(data.issued_at).toISOString().slice(0, 10),
    });
    return { buffer, filename: `${data.attestation_number}.pdf` };
  }
}
