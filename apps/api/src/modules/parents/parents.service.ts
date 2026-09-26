import { Injectable } from '@nestjs/common';
import { photoConsentsAllowed } from '../../shared/authorization/photo-consent';
import { PARENT_INVOICE_FIELDS_SQL, PARENT_RECEIPT_FIELDS_SQL } from './financial-projection';
import { CURRENT_GUARDIAN_LINK_SQL } from '../../shared/authorization/guardian-access';
import { PARENT_JOURNAL_VISIBILITY_SQL } from '../../shared/authorization/journal-disclosure';
import type { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AttendanceService } from '../attendance/attendance.service';
import { PdfStorageService } from '../billing/pdf-storage.service';
import { HealthService } from '../health/health.service';
import { MediaService } from '../media/media.service';
import { AuditService } from '../privacy/audit.service';

/** Chemin same-origin de lecture d'une photo côté parent (LOT 2 — P0 F5). */
export function parentPhotoContentPath(childId: string, mediaId: string): string {
  return `/api/v1/parent/children/${childId}/media/${mediaId}/content`;
}

/** Portail parent. Le contrôle est toujours child_guardians, jamais le rôle JWT. */
@Injectable()
export class ParentsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly attendance: AttendanceService,
    private readonly media: MediaService,
    private readonly pdfStorage: PdfStorageService,
    private readonly audit: AuditService,
    private readonly health: HealthService,
  ) {}

  async children(userId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT c.id, c.reference_number, c.first_name_fr, c.last_name_fr, c.date_of_birth,
              cg.can_view_journal, cg.can_view_health, cg.can_receive_push
       FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
       JOIN children c ON c.id = cg.child_id
       WHERE g.user_id = $1 AND c.deleted_at IS NULL
         AND cg.can_view_journal = true AND ${CURRENT_GUARDIAN_LINK_SQL}
       ORDER BY c.first_name_fr, c.last_name_fr`, [userId],
    )).rows);
  }

  async feed(userId: string, childId: string): Promise<Array<Record<string, unknown>>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    return this.tenantContext.withTenantConnection(async (client) => {
      const health = await client.query(
        `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
         WHERE cg.child_id = $1 AND g.user_id = $2 AND cg.can_view_health = true
           AND ${CURRENT_GUARDIAN_LINK_SQL} LIMIT 1`, [childId, userId],
      );
      return (await client.query(
        `SELECT id, event_type, occurred_at, meal_type, meal_quantity, nap_start_at, nap_end_at,
                nap_quality, diaper_type, activity_name, activity_notes, incident_severity,
                incident_description, visible_to_parents
         FROM daily_log_events WHERE child_id = $1 AND ${PARENT_JOURNAL_VISIBILITY_SQL}
         ORDER BY occurred_at DESC, id DESC LIMIT 100`, [childId, health.rows.length > 0],
      )).rows;
    });
  }

  async reportAbsence(userId: string, childId: string, reason?: string): Promise<Record<string, unknown>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    return this.attendance.markAbsent(userId, { child_id: childId, reason });
  }

  async consents(userId: string, childId: string): Promise<Array<Record<string, unknown>>> {
    await this.assertLinked(userId, childId);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT cr.id, cr.child_id, cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at
       FROM consent_records cr JOIN guardians g ON g.id = cr.guardian_id
       WHERE cr.child_id = $1 AND g.user_id = $2 ORDER BY cr.created_at DESC`, [childId, userId],
    )).rows);
  }

  async saveConsent(userId: string, dto: { child_id: string; consent_type: string; granted: boolean }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const guardian = await client.query(
        `SELECT cg.guardian_id FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
         WHERE cg.child_id = $1 AND g.user_id = $2 AND ${CURRENT_GUARDIAN_LINK_SQL}`, [dto.child_id, userId],
      );
      if (!guardian.rows[0]) throw Errors.notFound();
      const row = await client.query(
        `INSERT INTO consent_records (organization_id, guardian_id, child_id, consent_type, granted, granted_at, revoked_at, collection_method)
         VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NOW() ELSE NULL END,CASE WHEN $5 THEN NULL ELSE NOW() END,'parent_portal')
         RETURNING id, child_id, consent_type, granted, granted_at, revoked_at`,
        [tenantId, guardian.rows[0].guardian_id, dto.child_id, dto.consent_type, dto.granted],
      );
      return row.rows[0];
    });
  }

  async preferences(userId: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT event_type, is_enabled, quiet_hours_start, quiet_hours_end
       FROM notification_preferences WHERE organization_id = $1 AND user_id = $2 AND channel = 'push'`,
      [tenantId, userId],
    )).rows);
  }

  async savePreference(userId: string, dto: { event_type: string; is_enabled: boolean; quiet_hours_start?: string; quiet_hours_end?: string }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `INSERT INTO notification_preferences (organization_id,user_id,channel,event_type,is_enabled,quiet_hours_start,quiet_hours_end)
       VALUES ($1,$2,'push',$3,$4,$5,$6)
       -- La contrainte unique inclut organization_id depuis la migration 073
       -- (R19) : un même utilisateur peut gérer ses préférences indépendamment
       -- par crèche. Viser (user_id,channel,event_type) ne correspond plus à
       -- aucune contrainte — PostgreSQL rejette alors la requête entière, donc
       -- la préférence n'était jamais enregistrée.
       ON CONFLICT (organization_id,user_id,channel,event_type) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,
         quiet_hours_start=EXCLUDED.quiet_hours_start, quiet_hours_end=EXCLUDED.quiet_hours_end
       RETURNING event_type,is_enabled,quiet_hours_start,quiet_hours_end`,
      [tenantId, userId, dto.event_type, dto.is_enabled, dto.quiet_hours_start ?? null, dto.quiet_hours_end ?? null],
    )).rows[0]);
  }

  async photos(userId: string, childId: string, ip?: string): Promise<Array<Record<string, unknown>>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    // `media.list()` cloisonne le PERSONNEL par salle (memberships.room_ids).
    // Un parent n'appartient à aucune salle : ce filtrage renvoyait toujours
    // une liste vide, alors que le téléchargement direct de la même photo
    // fonctionnait. On utilise la lecture dédiée aux parents, qui filtre sur
    // l'enfant et sur is_visible_to_parents ; le lien de filiation vient
    // d'être vérifié ci-dessus et le consentement l'est à chaque signature.
    const visible = await this.media.listForParent(childId);
    const result: Array<Record<string, unknown>> = [];
    for (const item of visible) {
      try {
        result.push({ ...item, ...(await this.photoUrl(userId, childId, String(item.id), ip)) });
      } catch (error) {
        // Une révocation entre la liste et la signature ne divulgue jamais l'URL.
        if (!(error instanceof AppError) || error.code !== 'CONSENT_REVOKED') throw error;
      }
    }
    return result;
  }

  /**
   * Lien de lecture pour un parent : chemin **parent-scopé** same-origin.
   *
   * Pourquoi ne pas réutiliser le chemin `/media/:id/content` : il est réservé
   * au personnel (`@Roles(...STAFF_ROLES)`). Un parent n'a que les routes
   * `/parent/...`, qui revérifient la filiation (`child_guardians` vivant) et
   * le consentement photo à CHAQUE lecture. Le passage par `media.downloadUrl`
   * conserve la journalisation d'accès (media_access_logs + carnet 25-11).
   */
  async photoUrl(userId: string, childId: string, mediaId: string, ip?: string): Promise<{ url: string; key: string }> {
    await this.assertPhotoAllowed(userId, childId, mediaId);
    const { key } = await this.media.downloadUrl(userId, mediaId, ip);
    return { url: parentPhotoContentPath(childId, mediaId), key };
  }

  /**
   * Contenu d'une photo pour un parent — flux same-origin (LOT 2, P0 F5).
   *
   * Les contrôles sont refaits AVANT toute lecture d'octets : filiation
   * (`child_guardians` vivant), `is_visible_to_parents`, puis consentement
   * photo courant pour CHAQUE enfant présent (le retrait est immédiat, y
   * compris sur une photo ancienne déjà publiée). La journalisation
   * (media_access_logs + carnet d'accès) est celle de `MediaService`.
   */
  async photoContent(userId: string, childId: string, mediaId: string, ip?: string) {
    await this.assertPhotoAllowed(userId, childId, mediaId);
    return this.media.streamContent(userId, mediaId, ip);
  }

  /** Garde commune « cette photo est-elle lisible par ce parent, maintenant ? ». */
  private async assertPhotoAllowed(userId: string, childId: string, mediaId: string): Promise<void> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      // La révocation est effective immédiatement : une ancienne photo déjà
      // publiée ne peut plus obtenir d'URL si l'un des consentements manque.
      const r = await client.query(
        `SELECT child_id, children_in_photo, all_consents_checked FROM media_assets
         WHERE id=$1 AND child_id=$2 AND is_visible_to_parents=true AND deleted_at IS NULL`,
        [mediaId, childId],
      );
      if (!r.rows[0]) throw Errors.notFound();
      if (!await photoConsentsAllowed(client, tenantId, r.rows[0])) {
        throw new AppError('CONSENT_REVOKED', 'Le consentement photo a été retiré', 'تم سحب الموافقة على الصورة', 422);
      }
    });
  }

  // ── Factures et reçus (lecture seule, permission can_receive_invoices) ────

  async invoices(userId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT ${PARENT_INVOICE_FIELDS_SQL}
       FROM invoices i
       JOIN child_guardians cg ON cg.child_id = i.child_id
       JOIN guardians g ON g.id = cg.guardian_id
       JOIN children c ON c.id = i.child_id
       WHERE g.user_id = $1 AND ${CURRENT_GUARDIAN_LINK_SQL} AND cg.can_receive_invoices = true
       ORDER BY i.created_at DESC`, [userId],
    )).rows);
  }

  async invoiceDetail(userId: string, invoiceId: string): Promise<Record<string, unknown>> {
    const org = requireTenant(this.tenantContext);
    await this.assertInvoicePermission(userId, invoiceId);
    return this.tenantContext.withTenantConnection(async (client) => {
      const invoice = (await client.query(
        `SELECT ${PARENT_INVOICE_FIELDS_SQL}
         FROM invoices i JOIN children c ON c.id = i.child_id
         WHERE i.id = $1 AND i.organization_id = $2`, [invoiceId, org],
      )).rows[0];
      const lines = (await client.query(
        `SELECT id, description_fr, description_ar, quantity, unit_price, total_price, line_type
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order, id`, [invoiceId],
      )).rows;
      return { ...invoice, lines };
    });
  }

  /** PDF facture pour un parent autorisé (can_receive_invoices). */
  async invoicePdf(userId: string, invoiceId: string, ipAddress?: string) {
    const invoice = await this.assertInvoicePermission(userId, invoiceId);
    await this.audit.logDataAccess({
      organizationId: invoice.organization_id,
      userId,
      dataType: 'invoice_pdf',
      dataSubjectId: invoiceId,
      dataSubjectType: 'invoice',
      accessType: 'view',
      justification: 'consultation_facture_parent',
      ipAddress: ipAddress ?? null,
    });
    if (!invoice.pdf_url) throw new AppError('PDF_NOT_READY', 'Le PDF n’est pas encore généré', 'لم يتم إنشاء ملف PDF بعد', 404);
    // Défense croisée (audit) : la clé doit rester sous le préfixe DU TENANT.
    // Le worker écrit `${org}/invoices/${id}.pdf` ; une clé corrompue en base
    // ne doit jamais permettre de lire le PDF d'une autre organisation.
    if (!invoice.pdf_url.startsWith(`${invoice.organization_id}/`)) {
      throw new AppError(
        'STORAGE_POLICY',
        'Clé de stockage hors du périmètre de l’organisation',
        'مفتاح تخزين خارج نطاق المؤسسة',
        422,
      );
    }
    // LOT 2 (P0 F5) : plus de redirection vers une URL signée (MinIO n'est pas
    // joignable depuis un client). Le PDF est servi en flux same-origin par
    // l'API — un pdf_url orphelin reste un 404 clair, jamais un 500 (C4).
    const object = await this.pdfStorage.open(invoice.pdf_url as string);
    if (!object) {
      throw new AppError('PDF_NOT_READY', 'Le PDF n’est pas encore généré', 'لم يتم إنشاء ملف PDF بعد', 404);
    }
    return { kind: 'object' as const, object, invoice };
  }

  async receipts(userId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT ${PARENT_RECEIPT_FIELDS_SQL}
       FROM payments p
       JOIN child_guardians cg ON cg.child_id = p.child_id
       JOIN guardians g ON g.id = cg.guardian_id
       JOIN children c ON c.id = p.child_id
       WHERE g.user_id = $1 AND ${CURRENT_GUARDIAN_LINK_SQL} AND cg.can_receive_invoices = true AND p.status = 'confirmed'
       ORDER BY p.confirmed_at DESC`, [userId],
    )).rows);
  }

  async receiptDetail(userId: string, paymentId: string): Promise<Record<string, unknown>> {
    const org = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // C2 : hors tenant → 404 (pas de 403 révélateur d'existence).
      const payment = (await client.query(
        `SELECT ${PARENT_RECEIPT_FIELDS_SQL}
         FROM payments p JOIN children c ON c.id = p.child_id
         WHERE p.id = $1 AND p.organization_id = $2`, [paymentId, org],
      )).rows[0];
      if (!payment) throw Errors.notFound();
      const allowed = await this.canReceiveInvoices(client, userId, payment.child_id);
      if (!allowed) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour ce reçu', 'ليس لديك صلاحية لهذا الإيصال', 403);
      return payment;
    });
  }

  private async canReceiveInvoices(client: PoolClient, userId: string, childId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
       WHERE cg.child_id = $1 AND g.user_id = $2 AND ${CURRENT_GUARDIAN_LINK_SQL} AND cg.can_receive_invoices = true`,
      [childId, userId],
    );
    return Boolean(r.rows[0]);
  }

  /** Facture visible ? 404 si absente (RLS tenant), 403 si pas de permission parent. */
  private async assertInvoicePermission(
    userId: string,
    invoiceId: string,
  ): Promise<{ id: string; organization_id: string; invoice_number: string | null; pdf_url: string | null; child_id: string }> {
    const org = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // C2 : filtre tenant explicite — un objet hors tenant est invisible
      // (404, comme inexistant) : pas de 403 qui révélerait son existence.
      const invoice = (await client.query(
        `SELECT id, organization_id, invoice_number, pdf_url, child_id
         FROM invoices WHERE id = $1 AND organization_id = $2`, [invoiceId, org],
      )).rows[0];
      if (!invoice) throw Errors.notFound();
      const allowed = await this.canReceiveInvoices(client, userId, invoice.child_id);
      if (!allowed) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour cette facture', 'ليس لديك صلاحية لهذه الفاتورة', 403);
      return invoice;
    });
  }

  // ── Santé (permission can_view_health) ────────────────────────────────────

  /** Dossier santé visible parent : allergies + vaccinations + autorisations actives. */
  async childHealth(userId: string, childId: string, ipAddress?: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    const allowed = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
         WHERE cg.child_id = $1 AND g.user_id = $2 AND ${CURRENT_GUARDIAN_LINK_SQL} AND cg.can_view_health = true`,
        [childId, userId],
      );
      return Boolean(res.rows[0]);
    });
    if (!allowed) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour les données santé', 'ليس لديك صلاحية للبيانات الصحية', 403);
    const full = await this.health.getRecord(childId, userId, ipAddress);
    // Le parent ne reçoit pas les notes de confirmation internes (confirmed_by…).
    return {
      allergies: full.allergies,
      vaccinations: full.vaccinations,
      medication_authorizations: full.medication_authorizations,
      medication_administrations: ((full.medication_administrations as Array<Record<string, unknown>> | undefined) ?? []).map((m: Record<string, unknown>) => ({
        administered_at: m.administered_at,
        dose_given: m.dose_given,
        observations: m.observations,
        confirmed: Boolean(m.confirmed_by),
      })),
    };
  }

  private async assertLinked(userId: string, childId: string): Promise<void> { await this.assertPermission(userId, childId, 'guardian_id'); }
  private async assertPermission(userId: string, childId: string, permission: 'guardian_id' | 'can_view_journal'): Promise<void> {
    requireTenant(this.tenantContext);
    const allowed = await this.tenantContext.withTenantConnection(async (client) => {
      const column = permission === 'guardian_id' ? 'cg.guardian_id' : `cg.${permission}`;
      const res = await client.query(
        `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id=cg.guardian_id
         WHERE cg.child_id=$1 AND g.user_id=$2 AND ${CURRENT_GUARDIAN_LINK_SQL} AND ${column}${permission === 'guardian_id' ? ' IS NOT NULL' : ' = true'}`,
        [childId, userId],
      );
      return Boolean(res.rows[0]);
    });
    if (!allowed) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour cet enfant', 'ليس لديك صلاحية لهذا الطفل', 403);
  }
}
