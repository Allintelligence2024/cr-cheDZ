import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { EmailService } from '../../shared/email/email.service';
import { AuditService } from '../privacy/audit.service';
import { PdfStorageService } from './pdf-storage.service';
import { buildReceiptNumber } from './receipt';

/**
 * Facturation — Phase 8.
 *
 * Contrats, factures mensuelles idempotentes (index unique 021), paiements
 * espèces, allocations bornées en base (trigger 023), caisse quotidienne,
 * webhook de paiement signé/idempotent (024), PDF généré par le worker.
 *
 * Immuabilité : une facture payée ou annulée ne se modifie jamais
 * (trigger C04 + garde applicative → 422 INVOICE_IMMUTABLE).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly pdfStorage: PdfStorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // ── Contrats ──────────────────────────────────────────────────────────────

  async createContract(userId: string, dto: {
    child_id: string; monthly_base_amount?: number; start_date: string; end_date?: string; schedule_type?: string; discount_percent?: number;
    weekly_schedule?: number[]; hours_per_day?: number; annual_weeks?: number; daily_rate?: number; absence_deduction?: boolean; extra_day_rate?: number;
  }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const child = await c.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`, [dto.child_id]);
      if (!child.rows[0]) throw Errors.notFound();
      const weekly = dto.weekly_schedule ?? [7, 1, 2, 3, 4];
      // P2-2 : annualisation — lissage mensuel = tarif journalier × jours/semaine × semaines/an ÷ 12.
      let monthly = dto.monthly_base_amount;
      if (monthly === undefined) {
        if (dto.daily_rate === undefined || dto.annual_weeks === undefined) {
          throw new AppError('CONTRACT_AMOUNT_REQUIRED', 'Indiquer monthly_base_amount, ou daily_rate + annual_weeks pour un contrat annualisé', 'حدد المبلغ الشهري أو السعر اليومي وعدد الأسابيع السنوية', 422);
        }
        monthly = Math.round((dto.daily_rate * weekly.length * dto.annual_weeks) / 12 * 100) / 100;
      }
      if (dto.absence_deduction && dto.daily_rate === undefined) {
        throw new AppError('CONTRACT_DAILY_RATE_REQUIRED', 'daily_rate est requis pour déduire les absences', 'السعر اليومي مطلوب لخصم الغيابات', 422);
      }
      // Un seul contrat actif par enfant sur une période donnée.
      const overlap = await c.query(
        `SELECT id FROM contracts WHERE child_id=$1 AND is_active=true
           AND start_date <= COALESCE($3::date, 'infinity'::date) AND COALESCE(end_date, 'infinity'::date) >= $2::date`,
        [dto.child_id, dto.start_date, dto.end_date ?? null],
      );
      if (overlap.rows[0]) throw new AppError('CONTRACT_OVERLAP', 'Un contrat actif couvre déjà cette période pour cet enfant', 'يوجد عقد نشط يغطي هذه الفترة لهذا الطفل', 409);
      const r = await c.query(
        `INSERT INTO contracts(organization_id,child_id,monthly_base_amount,start_date,end_date,schedule_type,discount_percent,created_by,
                               weekly_schedule,hours_per_day,annual_weeks,daily_rate,absence_deduction,extra_day_rate)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [org, dto.child_id, monthly, dto.start_date, dto.end_date ?? null, dto.schedule_type ?? 'full_time', dto.discount_percent ?? 0, userId,
          weekly, dto.hours_per_day ?? null, dto.annual_weeks ?? null, dto.daily_rate ?? null, dto.absence_deduction ?? false, dto.extra_day_rate ?? null],
      );
      void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'contract', resourceId: r.rows[0].id, newValues: { child_id: dto.child_id, monthly_base_amount: monthly, annual_weeks: dto.annual_weeks ?? null } });
      return r.rows[0];
    });
  }

  /**
   * P2-2 : confrontation contrat × présences d'un mois — jours contractuels
   * attendus, présents, absents, jours présents HORS contrat (supplément).
   * Base de l'ajustement de facture (absence_deduction / extra_day_rate).
   */
  async contractPresence(client: { query: PoolClient['query'] }, contract: { id: string; child_id: string; weekly_schedule: number[]; start_date: string | Date; end_date: string | Date | null }, year: number, month: number) {
    const r = (await client.query(
      `WITH days AS (
         SELECT d::date AS d FROM generate_series(make_date($2,$3,1), (make_date($2,$3,1) + interval '1 month - 1 day')::date, interval '1 day') d
         WHERE d::date >= $4::date AND d::date <= COALESCE($5::date, 'infinity'::date)
       ), sess AS (
         SELECT session_date, status FROM attendance_sessions WHERE child_id=$1 AND session_date BETWEEN make_date($2,$3,1) AND (make_date($2,$3,1) + interval '1 month - 1 day')::date
       )
       SELECT
         COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM d)::int = ANY($6::int[]))::int AS contracted_days,
         COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM d)::int = ANY($6::int[]) AND s.status IN ('present','departed'))::int AS present_contracted,
         COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM d)::int = ANY($6::int[]) AND s.status = 'absent')::int AS absent_contracted,
         COUNT(*) FILTER (WHERE NOT (EXTRACT(ISODOW FROM d)::int = ANY($6::int[])) AND s.status IN ('present','departed'))::int AS extra_days
       FROM days LEFT JOIN sess s ON s.session_date = days.d`,
      [contract.child_id, year, month, contract.start_date, contract.end_date, contract.weekly_schedule],
    )).rows[0];
    return { contracted_days: r.contracted_days as number, present_contracted: r.present_contracted as number, absent_contracted: r.absent_contracted as number, extra_days: r.extra_days as number };
  }

  async listContracts(childId?: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (childId) { params.push(childId); where = ' AND child_id=$2'; }
      return (await c.query(
        `SELECT id, child_id, reference_number, schedule_type, monthly_base_amount, currency, weekly_schedule, hours_per_day, annual_weeks, daily_rate, absence_deduction, extra_day_rate,
                includes_meals, meal_amount, includes_transport, transport_amount,
                discount_percent, registration_fee, start_date, end_date, is_active, created_at
         FROM contracts WHERE organization_id=$1${where} ORDER BY created_at DESC`, params,
      )).rows;
    });
  }

  async getContract(contractId: string): Promise<Record<string, unknown>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      // C1 : filtre tenant explicite EN PLUS de la RLS (défense en profondeur).
      const r = await c.query(`SELECT * FROM contracts WHERE id=$1 AND organization_id=$2`, [contractId, org]);
      if (!r.rows[0]) throw Errors.notFound();
      return r.rows[0];
    });
  }

  // ── Factures ──────────────────────────────────────────────────────────────

  async generateInvoice(userId: string, dto: { contract_id: string; period_year: number; period_month: number; due_date: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const contract = (await c.query(`SELECT * FROM contracts WHERE id=$1 AND organization_id=$2 AND is_active=true`, [dto.contract_id, org])).rows[0];
      if (!contract) throw Errors.notFound();
      const exists = await c.query(
        `SELECT id FROM invoices WHERE contract_id=$1 AND period_year=$2 AND period_month=$3 AND status <> 'cancelled'`,
        [dto.contract_id, dto.period_year, dto.period_month],
      );
      if (exists.rows[0]) throw new AppError('INVOICE_ALREADY_EXISTS', 'Une facture existe déjà pour cette période', 'توجد فاتورة بالفعل لهذه الفترة', 409);
      const subtotal = Number(contract.monthly_base_amount)
        + (contract.includes_meals ? Number(contract.meal_amount ?? 0) : 0)
        + (contract.includes_transport ? Number(contract.transport_amount ?? 0) : 0);
      // P2-2 : ajustements depuis les présences réelles du mois (contrat ×
      // semaine type). Déduction des absences déclarées sur jours contractuels
      // (absence_deduction) et supplément des jours présents hors contrat
      // (extra_day_rate). Lignes séparées, traçables ; jamais rétroactif.
      const presence = await this.contractPresence(c, contract, dto.period_year, dto.period_month);
      const absenceDeduction = contract.absence_deduction && contract.daily_rate !== null
        ? Math.min(Number(contract.monthly_base_amount), Math.round(presence.absent_contracted * Number(contract.daily_rate) * 100) / 100) : 0;
      const extraAmount = contract.extra_day_rate !== null ? Math.round(presence.extra_days * Number(contract.extra_day_rate) * 100) / 100 : 0;
      const adjustedSubtotal = Math.round((subtotal - absenceDeduction + extraAmount) * 100) / 100;
      const discount = Math.round(adjustedSubtotal * Number(contract.discount_percent ?? 0)) / 100;
      const total = Math.round((adjustedSubtotal - discount) * 100) / 100;
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const invoice = (await c.query(
        `INSERT INTO invoices(organization_id,invoice_number,child_id,contract_id,period_year,period_month,subtotal,discount_amount,total_amount,due_date,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [org, `FAC-${dto.period_year}${String(dto.period_month).padStart(2, '0')}-${seq}`, contract.child_id, dto.contract_id, dto.period_year, dto.period_month, adjustedSubtotal, discount, total, dto.due_date, userId],
      )).rows[0];
      if (absenceDeduction > 0) {
        await c.query(
          `INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type)
           VALUES($1,$2,$3,$4,1,$5,$5,'adjustment')`,
          [org, invoice.id, `Déduction absences (${presence.absent_contracted} j. × ${Number(contract.daily_rate).toFixed(2)})`, `خصم الغيابات (${presence.absent_contracted} يوم)`, -absenceDeduction],
        );
      }
      if (extraAmount > 0) {
        await c.query(
          `INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type)
           VALUES($1,$2,$3,$4,$5,$6,$7,'adjustment')`,
          [org, invoice.id, 'Jours d\'accueil hors contrat', 'أيام استقبال خارج العقد', presence.extra_days, Number(contract.extra_day_rate), extraAmount],
        );
      }
      await c.query(
        `INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type)
         VALUES($1,$2,'Garde mensuelle','الرعاية الشهرية',1,$3,$3,'care')`,
        [org, invoice.id, subtotal],
      );
      if (contract.includes_meals) {
        await c.query(
          `INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type)
           VALUES($1,$2,'Repas','الوجبات',1,$3,$3,'meal')`,
          [org, invoice.id, Number(contract.meal_amount ?? 0)],
        );
      }
      if (contract.includes_transport) {
        await c.query(
          `INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type)
           VALUES($1,$2,'Transport','النقل',1,$3,$3,'transport')`,
          [org, invoice.id, Number(contract.transport_amount ?? 0)],
        );
      }
      await c.query(
        `INSERT INTO background_jobs(organization_id,job_type,payload,priority) VALUES($1,'generate_invoice_pdf',$2,2)`,
        [org, JSON.stringify({ invoice_id: invoice.id })],
      );
      return { ...invoice, presence };
    });
  }

  async listInvoices(childId?: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (childId) { params.push(childId); where = ' AND child_id=$2'; }
      return (await c.query(
        `SELECT id,invoice_number,child_id,contract_id,period_year,period_month,subtotal,discount_amount,total_amount,paid_amount,balance,status,due_date,pdf_url,created_at
         FROM invoices WHERE organization_id=$1${where} ORDER BY created_at DESC`, params,
      )).rows;
    });
  }

  async getInvoice(invoiceId: string): Promise<Record<string, unknown>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const invoice = (await c.query(
        `SELECT i.*, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name
         FROM invoices i JOIN children ch ON ch.id = i.child_id
         WHERE i.id=$1 AND i.organization_id=$2`, [invoiceId, org],
      )).rows[0];
      if (!invoice) throw Errors.notFound();
      const lines = (await c.query(
        `SELECT id, description_fr, description_ar, quantity, unit_price, total_price, line_type
         FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort_order, id`, [invoiceId],
      )).rows;
      return { ...invoice, lines };
    });
  }

  // ── Impayés & relances (P2-3) ─────────────────────────────────────────────

  /**
   * draft → sent : la facture devient exigible (une facture brouillon n'est
   * pas un impayé — contrat du tableau de bord phase 9). Idempotent (409 si
   * déjà émise), refuse une facture payée/annulée (422).
   */
  async markInvoiceSent(userId: string, invoiceId: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const inv = (await c.query(`SELECT id, status FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [invoiceId, org])).rows[0];
      if (!inv) throw Errors.notFound();
      if (['paid', 'cancelled'].includes(inv.status)) throw Errors.invoiceImmutable();
      if (inv.status !== 'draft') throw new AppError('INVOICE_ALREADY_SENT', 'La facture a déjà été émise', 'تم إصدار الفاتورة بالفعل', 409);
      const r = await c.query(
        `UPDATE invoices SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id, invoice_number, status, sent_at, due_date, balance`,
        [invoiceId],
      );
      void this.audit.log({ organizationId: org, userId, action: 'update', resourceType: 'invoice', resourceId: invoiceId, resourceLabel: 'invoice.sent', oldValues: { status: 'draft' }, newValues: { status: 'sent' } });
      return r.rows[0];
    });
  }

  /**
   * Journal des impayés (balance âgée). La transition sent/partially_paid →
   * overdue (échéance dépassée, date d'Alger) est appliquée À LA LECTURE via
   * invoices_mark_overdue (068) : la fraîcheur ne dépend d'aucun job.
   * Tranches : 0-30 / 31-60 / 61-90 / 90+ jours de retard.
   */
  async agedBalance(): Promise<{ as_of: string; totals: Record<string, unknown>; invoices: Array<Record<string, unknown>> }> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      await c.query(`SELECT invoices_mark_overdue($1)`, [org]);
      const rows = (await c.query(
        `SELECT i.id, i.invoice_number, i.child_id, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name,
                i.total_amount, i.paid_amount, i.balance, i.status, i.due_date,
                GREATEST(0, (NOW() AT TIME ZONE 'Africa/Algiers')::date - i.due_date)::int AS days_overdue,
                COALESCE((SELECT MAX(r.level) FROM invoice_reminders r WHERE r.invoice_id = i.id), 0)::int AS last_reminder_level,
                (SELECT MAX(r.sent_at) FROM invoice_reminders r WHERE r.invoice_id = i.id) AS last_reminder_at
         FROM invoices i JOIN children ch ON ch.id = i.child_id
         WHERE i.organization_id = $1 AND i.status IN ('sent','partially_paid','overdue') AND i.balance > 0
         ORDER BY i.due_date, i.invoice_number`, [org],
      )).rows;
      const bucket = (d: number) => (d <= 0 ? 'not_due' : d <= 30 ? 'd0_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus');
      const totals: Record<string, number> = { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, overdue_total: 0, outstanding_total: 0, overdue_count: 0 };
      for (const r of rows) {
        const bal = Number(r.balance); const d = Number(r.days_overdue);
        r.aging_bucket = bucket(d);
        totals[r.aging_bucket] += bal; totals.outstanding_total += bal;
        if (d > 0) { totals.overdue_total += bal; totals.overdue_count += 1; }
      }
      for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
      return { as_of: (await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date::text AS d`)).rows[0].d, totals, invoices: rows };
    });
  }

  /**
   * Relance d'impayé. Règles :
   *  - facture exigible avec solde > 0 (sent/partially_paid/overdue), sinon 422 ;
   *  - niveaux strictement croissants (1 → 2 → 3), un seul par niveau (409) ;
   *  - channel=email : envoi RÉEL au tuteur facturable (can_receive_invoices,
   *    puis is_primary) — fail-closed : transport absent → 503, échec → 502,
   *    et la ligne invoice_reminders n'est écrite QUE si l'envoi a réussi
   *    (même transaction, ROLLBACK sinon) ; aucun tuteur avec email → 422 ;
   *  - channel=manual : trace d'un appel/entretien, notes obligatoires.
   */
  async sendReminder(userId: string, invoiceId: string, dto: { level: 1 | 2 | 3; channel: 'email' | 'manual'; notes?: string }) {
    const org = requireTenant(this.tenant);
    if (dto.channel === 'manual' && !dto.notes?.trim()) {
      throw new AppError('REMINDER_NOTES_REQUIRED', 'Une relance manuelle doit être documentée (notes)', 'يجب توثيق التذكير اليدوي (ملاحظات)', 400);
    }
    return this.tenant.withTenantConnection(async (c) => {
      await c.query(`SELECT invoices_mark_overdue($1)`, [org]);
      const inv = (await c.query(
        `SELECT i.id, i.invoice_number, i.status, i.balance, i.due_date::text AS due_date, i.child_id,
                ch.first_name_fr, ch.last_name_fr, o.name_fr AS org_name
         FROM invoices i JOIN children ch ON ch.id = i.child_id JOIN organizations o ON o.id = i.organization_id
         WHERE i.id=$1 AND i.organization_id=$2 FOR UPDATE OF i`, [invoiceId, org],
      )).rows[0];
      if (!inv) throw Errors.notFound();
      if (!['sent', 'partially_paid', 'overdue'].includes(inv.status) || Number(inv.balance) <= 0) {
        throw new AppError('INVOICE_NOT_RECEIVABLE', 'Seule une facture émise avec un solde dû peut être relancée', 'لا يمكن التذكير إلا بفاتورة صادرة برصيد مستحق', 422);
      }
      const last = (await c.query(`SELECT COALESCE(MAX(level),0)::int AS l FROM invoice_reminders WHERE invoice_id=$1`, [invoiceId])).rows[0].l as number;
      if (dto.level <= last) throw new AppError('REMINDER_LEVEL_ALREADY_SENT', `Une relance de niveau ${dto.level} a déjà été envoyée`, 'تم إرسال تذكير بهذا المستوى بالفعل', 409);
      if (dto.level !== last + 1) throw new AppError('REMINDER_LEVEL_SEQUENCE', `Le prochain niveau de relance est ${last + 1}`, 'يجب اتباع تسلسل مستويات التذكير', 422);

      let guardianId: string | null = null;
      if (dto.channel === 'email') {
        const g = (await c.query(
          `SELECT g.id, g.email FROM guardians g
           JOIN child_guardians cg ON cg.guardian_id = g.id AND cg.organization_id = g.organization_id
           WHERE cg.child_id = $1 AND cg.organization_id = $2 AND g.email IS NOT NULL AND g.deleted_at IS NULL
           ORDER BY cg.can_receive_invoices DESC, cg.is_primary DESC, g.email LIMIT 1`, [inv.child_id, org],
        )).rows[0];
        if (!g) throw new AppError('REMINDER_NO_RECIPIENT', 'Aucun tuteur avec adresse email pour cet enfant', 'لا يوجد ولي أمر ببريد إلكتروني لهذا الطفل', 422);
        guardianId = g.id;
        // Envoi AVANT l'INSERT : un échec lève (503/502) → ROLLBACK, aucune trace.
        await this.email.sendInvoiceReminder({
          to: g.email, orgName: inv.org_name, invoiceNumber: inv.invoice_number,
          childName: `${inv.first_name_fr} ${inv.last_name_fr}`.trim(), balanceDue: Number(inv.balance), dueDate: inv.due_date, level: dto.level,
        });
      }
      const r = (await c.query(
        `INSERT INTO invoice_reminders(organization_id, invoice_id, level, channel, balance_due, guardian_id, notes, sent_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, invoice_id, level, channel, balance_due, guardian_id, notes, sent_at`,
        [org, invoiceId, dto.level, dto.channel, Number(inv.balance), guardianId, dto.notes ?? null, userId],
      )).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'invoice_reminder', resourceId: r.id, resourceLabel: inv.invoice_number, newValues: { invoice_id: invoiceId, level: dto.level, channel: dto.channel } });
      return r;
    });
  }

  async listReminders(invoiceId: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const inv = await c.query(`SELECT 1 FROM invoices WHERE id=$1 AND organization_id=$2`, [invoiceId, org]);
      if (!inv.rows[0]) throw Errors.notFound();
      return (await c.query(
        `SELECT id, level, channel, balance_due, guardian_id, notes, sent_by, sent_at FROM invoice_reminders WHERE invoice_id=$1 AND organization_id=$2 ORDER BY level`,
        [invoiceId, org],
      )).rows;
    });
  }

  // ── Paiements ─────────────────────────────────────────────────────────────

  async recordCashPayment(userId: string, dto: { invoice_id: string; amount: number; notes?: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      // B1 : le site d'encaissement (site de l'enfant à l'instant T) est figé
      // sur le paiement — une mutation ultérieure de l'enfant ne déplace pas
      // le flux de caisse d'un site à l'autre.
      const invoice = (await c.query(
        `SELECT i.id, i.child_id, i.total_amount, i.paid_amount, i.status, ch.site_id
         FROM invoices i JOIN children ch ON ch.id = i.child_id
         WHERE i.id = $1 AND i.organization_id = $2 FOR UPDATE`,
        [dto.invoice_id, org],
      )).rows[0];
      if (!invoice) throw Errors.notFound();
      if (['paid', 'cancelled'].includes(invoice.status)) throw Errors.invoiceImmutable();
      const due = Number(invoice.total_amount) - Number(invoice.paid_amount);
      if (dto.amount > due) throw new AppError('PAYMENT_EXCEEDS_BALANCE', 'Le paiement dépasse le solde de la facture', 'الدفعة تتجاوز رصيد الفاتورة', 422);
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const payment = (await c.query(
        `INSERT INTO payments(organization_id,reference_number,receipt_number,child_id,amount,method,status,received_at,confirmed_at,notes,created_by,site_id)
         VALUES($1,$2,$3,$4,$5,'cash','confirmed',NOW(),NOW(),$6,$7,$8) RETURNING id,reference_number,receipt_number,amount,status`,
        [org, `PAY-${seq}`, buildReceiptNumber(seq, org), invoice.child_id, dto.amount, dto.notes ?? null, userId, invoice.site_id],
      )).rows[0];
      await c.query(
        `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by) VALUES($1,$2,$3,$4,$5)`,
        [org, payment.id, invoice.id, dto.amount, userId],
      );
      const updated = (await c.query(
        `UPDATE invoices SET paid_amount=paid_amount+$2,
           status=CASE WHEN paid_amount+$2=total_amount THEN 'paid'::invoice_status ELSE 'partially_paid'::invoice_status END,
           updated_at=NOW() WHERE id=$1 RETURNING paid_amount,balance,status`,
        [invoice.id, dto.amount],
      )).rows[0];
      // Accusé de paiement — best-effort : jamais bloquant pour l'encaissement.
      void this.sendReceiptBestEffort(org, payment, invoice.child_id);
      return { ...payment, invoice: updated };
    });
  }

  /** Reçu envoyé au tuteur facturable ; silencieux si transport indisponible. */
  private async sendReceiptBestEffort(
    orgId: string,
    payment: { receipt_number: string; amount: number; method: string },
    childId: string,
  ): Promise<void> {
    try {
      const orgName = (await this.pool.query(
        `SELECT name_fr FROM organizations WHERE id = $1`, [orgId],
      )).rows[0]?.name_fr as string | undefined;
      if (!orgName) return;
      const recipient = await this.tenant.withTenantConnection(async (c) => {
        const res = await c.query(
          `SELECT g.email
           FROM guardians g
           JOIN child_guardians cg
             ON cg.guardian_id = g.id AND cg.organization_id = g.organization_id
           WHERE cg.child_id = $1 AND cg.organization_id = $2 AND g.email IS NOT NULL
           ORDER BY cg.is_primary DESC, g.email
           LIMIT 1`,
          [childId, orgId],
        );
        return res.rows[0]?.email as string | undefined;
      });
      if (!recipient) return;
      await this.email.sendPaymentReceipt({
        to: recipient,
        orgName,
        receiptNumber: payment.receipt_number,
        amount: Number(payment.amount),
        method: payment.method,
      });
    } catch (error) {
      // Un échec d'envoi ne doit jamais remettre en cause l'encaissement.
      void error;
    }
  }

  /** Allocation d'un paiement confirmé vers une facture (bornes en base, trigger 023). */
  async allocatePayment(userId: string, paymentId: string, dto: { invoice_id: string; amount_allocated: number }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const payment = (await c.query(`SELECT id,amount,status FROM payments WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [paymentId, org])).rows[0];
      if (!payment) throw Errors.notFound();
      if (payment.status !== 'confirmed') {
        throw new AppError('PAYMENT_NOT_CONFIRMED', 'Seul un paiement confirmé peut être alloué', 'يمكن تخصيص الدفعات المؤكدة فقط', 422);
      }
      const invoice = (await c.query(`SELECT id,status,total_amount,paid_amount FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [dto.invoice_id, org])).rows[0];
      if (!invoice) throw Errors.notFound();
      if (['paid', 'cancelled'].includes(invoice.status)) throw Errors.invoiceImmutable();
      // Mêmes bornes que le trigger 023, dans le même ordre (paiement, puis facture).
      const allocated = (await c.query(
        `SELECT COALESCE(SUM(amount_allocated),0)::numeric AS total FROM payment_allocations WHERE payment_id=$1`,
        [paymentId],
      )).rows[0].total;
      if (Number(allocated) + dto.amount_allocated > Number(payment.amount)) {
        throw new AppError('PAYMENT_ALLOCATION_EXCEEDS_PAYMENT', 'L’allocation dépasse le montant du paiement', 'التخصيص يتجاوز مبلغ الدفعة', 422);
      }
      const remaining = Number(invoice.total_amount) - Number(invoice.paid_amount);
      if (dto.amount_allocated > remaining) {
        throw new AppError('PAYMENT_ALLOCATION_EXCEEDS_INVOICE', 'L’allocation dépasse le solde de la facture', 'التخصيص يتجاوز رصيد الفاتورة', 422);
      }
      try {
        const allocation = (await c.query(
          `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
           VALUES($1,$2,$3,$4,$5) RETURNING id,payment_id,invoice_id,amount_allocated`,
          [org, paymentId, dto.invoice_id, dto.amount_allocated, userId],
        )).rows[0];
        const updated = (await c.query(
          `UPDATE invoices SET paid_amount=paid_amount+$2,
             status=CASE WHEN paid_amount+$2=total_amount THEN 'paid'::invoice_status ELSE 'partially_paid'::invoice_status END,
             updated_at=NOW() WHERE id=$1 RETURNING paid_amount,balance,status`,
          [dto.invoice_id, dto.amount_allocated],
        )).rows[0];
        return { ...allocation, invoice: updated };
      } catch (error) {
        throw this.mapAllocationError(error);
      }
    });
  }

  async listPayments(childId?: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (childId) { params.push(childId); where = ' AND child_id=$2'; }
      return (await c.query(
        `SELECT id,reference_number,receipt_number,child_id,amount,method,status,external_reference,payment_gateway,received_at,confirmed_at,notes,created_at
         FROM payments WHERE organization_id=$1${where} ORDER BY created_at DESC`, params,
      )).rows;
    });
  }

  /**
   * P1-1 : journal de rapprochement des paiements en ligne (SATIM).
   * Pour chaque paiement 'satim' : état, facture, âge ; les 'pending' plus
   * vieux que `staleMinutes` (défaut 30) sont signalés `stale` — un init sans
   * webhook de confirmation dans ce délai est soit abandonné par le parent,
   * soit un webhook perdu à réclamer au PSP (transaction_id fourni).
   * Aucun statut n'est modifié ici : un pending n'est JAMAIS deviné payé.
   */
  async onlineReconciliation(staleMinutes = 30, from?: string, to?: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org, `${staleMinutes} minutes`];
      let where = '';
      if (from) { params.push(from); where += ` AND p.created_at >= $${params.length}`; }
      if (to) { params.push(to); where += ` AND p.created_at < ($${params.length}::date + 1)`; }
      const rows = (await c.query(
        `SELECT p.id, p.reference_number, p.external_reference, p.amount, p.method, p.status, p.created_at, p.confirmed_at,
                p.gateway_response->>'transaction_id' AS transaction_id, p.gateway_response->>'error' AS gateway_error,
                p.gateway_response->>'reason' AS failure_reason,
                i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.balance AS invoice_balance,
                (p.status='pending' AND p.created_at < NOW() - $2::interval) AS stale
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.organization_id=$1
           -- init SATIM (payment_gateway='satim') ; à la confirmation, billing_webhook_apply
           -- remplace le gateway par le réseau carte (cib/edahabia) : la référence 'satim-…' reste la clé.
           AND (p.payment_gateway IN ('satim','cib','edahabia') OR p.external_reference LIKE 'satim-%')${where}
         ORDER BY p.created_at DESC`, params,
      )).rows;
      const sum = (f: (r: Record<string, unknown>) => boolean) => rows.filter(f).reduce((a, r) => a + Number(r.amount), 0);
      return {
        stale_after_minutes: staleMinutes,
        totals: {
          confirmed: { count: rows.filter((r) => r.status === 'confirmed').length, amount: sum((r) => r.status === 'confirmed') },
          pending: { count: rows.filter((r) => r.status === 'pending' && !r.stale).length, amount: sum((r) => r.status === 'pending' && !r.stale) },
          stale: { count: rows.filter((r) => r.stale).length, amount: sum((r) => Boolean(r.stale)) },
          failed: { count: rows.filter((r) => r.status === 'failed').length, amount: sum((r) => r.status === 'failed') },
        },
        items: rows,
      };
    });
  }

  async getPayment(paymentId: string): Promise<Record<string, unknown>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const payment = (await c.query(
        `SELECT p.*, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name
         FROM payments p JOIN children ch ON ch.id=p.child_id
         WHERE p.id=$1 AND p.organization_id=$2`, [paymentId, org],
      )).rows[0];
      if (!payment) throw Errors.notFound();
      const allocations = (await c.query(
        `SELECT id, invoice_id, amount_allocated, allocated_at FROM payment_allocations WHERE payment_id=$1 ORDER BY allocated_at`, [paymentId],
      )).rows;
      return { ...payment, allocations };
    });
  }

  // ── Caisse quotidienne ────────────────────────────────────────────────────

  async openCashRegister(_userId: string, dto: { site_id: string; opening_balance?: number }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const site = await c.query(`SELECT id FROM sites WHERE id=$1`, [dto.site_id]);
      if (!site.rows[0]) throw Errors.notFound();
      const date = (await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d;
      // B2 : un registre d'un jour antérieur reste ouvert → erreur explicite
      // (pas de blocage silencieux) : il faut d'abord le clôturer — la
      // clôture cible le registre ouvert le plus récent du site.
      const previous = (await c.query(
        `SELECT register_date FROM daily_cash_registers
         WHERE site_id=$1 AND closed_at IS NULL AND register_date < $2
         ORDER BY register_date DESC LIMIT 1`,
        [dto.site_id, date],
      )).rows[0];
      if (previous) {
        const prevDate = new Date(previous.register_date).toISOString().slice(0, 10);
        throw new AppError(
          'CASH_OPEN_PREVIOUS_DAY',
          `Un registre du ${prevDate} reste ouvert sur ce site — clôturez-le avant d'ouvrir la caisse du jour`,
          'سجل سابق ما يزال مفتوحًا — أغلقه أولاً قبل فتح صندوق اليوم',
          409,
        );
      }
      const r = await c.query(
        `INSERT INTO daily_cash_registers(organization_id,site_id,register_date,opening_balance)
         VALUES($1,$2,$3,$4) ON CONFLICT(site_id,register_date) DO NOTHING RETURNING *`,
        [org, dto.site_id, date, dto.opening_balance ?? 0],
      );
      if (!r.rows[0]) throw new AppError('CASH_REGISTER_ALREADY_OPEN', 'La caisse est déjà ouverte', 'الصندوق مفتوح بالفعل', 409);
      return r.rows[0];
    });
  }

  /**
   * Clôture le registre ouvert le plus récent du site (B2 : inclut un registre
   * de la veille non clôturé — le chemin de reprise de CASH_OPEN_PREVIOUS_DAY).
   * B1 : le total agrège le site d'encaissement FIGÉ sur les paiements
   * (p.site_id), pas le site courant de l'enfant. total_cash_out reste 0 :
   * aucun flux de décaissement n'existe (commentaire de colonne, migration 066).
   */
  async closeCashRegister(userId: string, dto: { site_id: string; notes?: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const date = (await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d;
      let register = (await c.query(
        `SELECT * FROM daily_cash_registers
         WHERE site_id=$1 AND register_date=$2 AND closed_at IS NULL FOR UPDATE`,
        [dto.site_id, date],
      )).rows[0];
      if (!register) {
        register = (await c.query(
          `SELECT * FROM daily_cash_registers
           WHERE site_id=$1 AND closed_at IS NULL AND register_date < $2
           ORDER BY register_date DESC LIMIT 1 FOR UPDATE`,
          [dto.site_id, date],
        )).rows[0];
      }
      if (!register) {
        // Aucun registre ouvert : distinguer « clôturé aujourd'hui » de
        // « jamais ouvert aujourd'hui » (codes existants conservés).
        const today = (await c.query(
          `SELECT id FROM daily_cash_registers WHERE site_id=$1 AND register_date=$2`,
          [dto.site_id, date],
        )).rows[0];
        throw new AppError(
          today ? 'CASH_REGISTER_CLOSED' : 'CASH_REGISTER_NOT_OPEN',
          today ? 'La caisse est déjà clôturée' : 'La caisse n’est pas ouverte',
          today ? 'الصندوق مغلق بالفعل' : 'الصندوق غير مفتوح',
          409,
        );
      }
      const total = (await c.query(
        `SELECT COALESCE(SUM(p.amount),0) AS total
         FROM payments p
         WHERE p.organization_id=$1 AND p.method='cash' AND p.status='confirmed'
           AND p.site_id=$2 AND (p.confirmed_at AT TIME ZONE 'Africa/Algiers')::date=$3`,
        [org, dto.site_id, register.register_date],
      )).rows[0].total;
      return (await c.query(
        `UPDATE daily_cash_registers SET total_cash_in=$1,closing_balance=opening_balance+$1,closed_at=NOW(),closed_by=$2,notes=$3 WHERE id=$4 RETURNING *`,
        [total, userId, dto.notes ?? null, register.id],
      )).rows[0];
    });
  }

  async listCashRegisters(siteId?: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      if (siteId) {
        const site = await c.query(`SELECT id FROM sites WHERE id=$1`, [siteId]);
        if (!site.rows[0]) throw Errors.notFound();
      }
      const params: unknown[] = [org];
      let where = '';
      if (siteId) { params.push(siteId); where = ' AND site_id=$2'; }
      return (await c.query(
        `SELECT id, site_id, register_date, opening_balance, closing_balance, total_cash_in, total_cash_out, closed_at, notes
         FROM daily_cash_registers WHERE organization_id=$1${where} ORDER BY register_date DESC`, params,
      )).rows;
    });
  }

  // ── Webhook de paiement (signé, idempotent) ───────────────────────────────

  /**
   * Applique un webhook de paiement. La signature HMAC-SHA256 est vérifiée par
   * le contrôleur sur le corps brut (PAYMENT_WEBHOOK_SECRET). L'écriture passe
   * par billing_webhook_apply() — fonction SECURITY DEFINER (migration 024,
   * même pattern bootstrap que l'auth) car le webhook n'a pas de JWT : la
   * fonction résout le tenant depuis la facture. Idempotence : un même
   * external_reference envoyé N fois = un seul paiement.
   */
  async applyWebhookPayment(params: { invoice_id: string; external_reference: string; amount: number; gateway?: string; paid_at?: string; notes?: string }) {
    try {
      const r = await this.pool.query(
        `SELECT * FROM billing_webhook_apply($1,$2,$3,$4,$5,$6)`,
        [params.invoice_id, params.external_reference, params.amount, params.gateway ?? 'bank_transfer', params.paid_at ?? null, params.notes ?? null],
      );
      return r.rows[0];
    } catch (error) {
      throw this.mapWebhookError(error);
    }
  }

  // ── PDF facture ───────────────────────────────────────────────────────────

  /** Téléchargement autorisé : retourne le buffer PDF (local) ou l'URL signée (S3). */
  async invoicePdf(userId: string, invoiceId: string, ipAddress?: string) {
    const org = requireTenant(this.tenant);
    const invoice = await this.tenant.withTenantConnection(async (c) => {
      const r = await c.query(`SELECT id, organization_id, pdf_url FROM invoices WHERE id=$1 AND organization_id=$2`, [invoiceId, org]);
      if (!r.rows[0]) throw Errors.notFound();
      if (!r.rows[0].pdf_url) throw new AppError('PDF_NOT_READY', 'Le PDF n’est pas encore généré', 'لم يتم إنشاء ملف PDF بعد', 404);
      return r.rows[0];
    });
    // Journal d'accès (loi 25-11) : qui consulte le PDF de facture.
    await this.audit.logDataAccess({
      organizationId: invoice.organization_id,
      userId,
      dataType: 'invoice_pdf',
      dataSubjectId: invoiceId,
      dataSubjectType: 'invoice',
      accessType: 'view',
      justification: 'consultation_facture',
      ipAddress: ipAddress ?? null,
    });
    // Défense croisée (audit) : la clé doit rester sous le préfixe DU TENANT
    // (« ${org}/invoices/… », format écrit par le worker) — une clé corrompue
    // en base ne doit jamais faire lire le PDF d'une autre organisation.
    if (!String(invoice.pdf_url).startsWith(`${org}/`)) {
      throw new AppError(
        'STORAGE_POLICY',
        'Clé de stockage hors du périmètre de l’organisation',
        'مفتاح تخزين خارج نطاق المؤسسة',
        422,
      );
    }
    // LOT 2 (P0 F5) : plus de redirection vers une URL signée S3 (MinIO est
    // lié à 127.0.0.1 en production — l'URL était inexploitable). Lecture en
    // flux same-origin ; C4 conservé : un pdf_url orphelin → 404, jamais un 500.
    const object = await this.pdfStorage.open(invoice.pdf_url as string);
    if (!object) {
      throw new AppError('PDF_NOT_READY', 'Le PDF n’est pas encore généré', 'لم يتم إنشاء ملف PDF بعد', 404);
    }
    return { kind: 'object' as const, object, invoice };
  }

  // ── Mapping des erreurs PostgreSQL (triggers C04 / 023) ───────────────────

  private mapAllocationError(error: unknown): AppError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PAYMENT_ALLOCATION_EXCEEDS_PAYMENT')) {
      return new AppError('PAYMENT_ALLOCATION_EXCEEDS_PAYMENT', 'L’allocation dépasse le montant du paiement', 'التخصيص يتجاوز مبلغ الدفعة', 422);
    }
    if (message.includes('PAYMENT_ALLOCATION_EXCEEDS_INVOICE')) {
      return new AppError('PAYMENT_ALLOCATION_EXCEEDS_INVOICE', 'L’allocation dépasse le solde de la facture', 'التخصيص يتجاوز رصيد الفاتورة', 422);
    }
    if (message.includes('INVOICE_IMMUTABLE')) return Errors.invoiceImmutable();
    throw error;
  }

  private mapWebhookError(error: unknown): AppError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('INVOICE_NOT_FOUND')) return Errors.notFound();
    if (message.includes('INVOICE_IMMUTABLE')) return Errors.invoiceImmutable();
    if (message.includes('PAYMENT_EXCEEDS_BALANCE')) {
      return new AppError('PAYMENT_EXCEEDS_BALANCE', 'Le paiement dépasse le solde de la facture', 'الدفعة تتجاوز رصيد الفاتورة', 422);
    }
    if (message.includes('PAYMENT_AMOUNT_MISMATCH')) {
      // P2 — montant du webhook ≠ montant du paiement : refus explicite
      // (migration 052). Jamais de « correction » silencieuse du montant :
      // le paiement reste tel quel, un humain rapproche.
      return new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        'Le montant du webhook ne correspond pas au montant du paiement — le paiement n’est PAS confirmé, contactez le support',
        'مبلغ الـ webhook غير مطابق لمبلغ الدفع — الدفع غير مؤكد، اتصل بالدعم',
        422,
      );
    }
    throw error;
  }

  /** Secret de signature des webhooks (PAYMENT_WEBHOOK_SECRET). */
  webhookSecret(): string | null {
    return this.config.get<string>('PAYMENT_WEBHOOK_SECRET') ?? null;
  }
}
