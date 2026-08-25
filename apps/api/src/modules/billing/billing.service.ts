import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { PdfStorageService } from './pdf-storage.service';

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
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // ── Contrats ──────────────────────────────────────────────────────────────

  async createContract(userId: string, dto: { child_id: string; monthly_base_amount: number; start_date: string; end_date?: string; schedule_type?: string; discount_percent?: number }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const child = await c.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`, [dto.child_id]);
      if (!child.rows[0]) throw Errors.notFound();
      const r = await c.query(
        `INSERT INTO contracts(organization_id,child_id,monthly_base_amount,start_date,end_date,schedule_type,discount_percent,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [org, dto.child_id, dto.monthly_base_amount, dto.start_date, dto.end_date ?? null, dto.schedule_type ?? 'full_time', dto.discount_percent ?? 0, userId],
      );
      return r.rows[0];
    });
  }

  async listContracts(childId?: string): Promise<Array<Record<string, unknown>>> {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (childId) { params.push(childId); where = ' AND child_id=$2'; }
      return (await c.query(
        `SELECT id, child_id, reference_number, schedule_type, monthly_base_amount, currency,
                includes_meals, meal_amount, includes_transport, transport_amount,
                discount_percent, registration_fee, start_date, end_date, is_active, created_at
         FROM contracts WHERE organization_id=$1${where} ORDER BY created_at DESC`, params,
      )).rows;
    });
  }

  async getContract(contractId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const r = await c.query(`SELECT * FROM contracts WHERE id=$1`, [contractId]);
      if (!r.rows[0]) throw Errors.notFound();
      return r.rows[0];
    });
  }

  // ── Factures ──────────────────────────────────────────────────────────────

  async generateInvoice(userId: string, dto: { contract_id: string; period_year: number; period_month: number; due_date: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const contract = (await c.query(`SELECT * FROM contracts WHERE id=$1 AND is_active=true`, [dto.contract_id])).rows[0];
      if (!contract) throw Errors.notFound();
      const exists = await c.query(
        `SELECT id FROM invoices WHERE contract_id=$1 AND period_year=$2 AND period_month=$3 AND status <> 'cancelled'`,
        [dto.contract_id, dto.period_year, dto.period_month],
      );
      if (exists.rows[0]) throw new AppError('INVOICE_ALREADY_EXISTS', 'Une facture existe déjà pour cette période', 'توجد فاتورة بالفعل لهذه الفترة', 409);
      const subtotal = Number(contract.monthly_base_amount)
        + (contract.includes_meals ? Number(contract.meal_amount ?? 0) : 0)
        + (contract.includes_transport ? Number(contract.transport_amount ?? 0) : 0);
      const discount = Math.round(subtotal * Number(contract.discount_percent ?? 0)) / 100;
      const total = subtotal - discount;
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const invoice = (await c.query(
        `INSERT INTO invoices(organization_id,invoice_number,child_id,contract_id,period_year,period_month,subtotal,discount_amount,total_amount,due_date,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [org, `FAC-${dto.period_year}${String(dto.period_month).padStart(2, '0')}-${seq}`, contract.child_id, dto.contract_id, dto.period_year, dto.period_month, subtotal, discount, total, dto.due_date, userId],
      )).rows[0];
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
      return invoice;
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
    requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const invoice = (await c.query(
        `SELECT i.*, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name
         FROM invoices i JOIN children ch ON ch.id = i.child_id WHERE i.id=$1`, [invoiceId],
      )).rows[0];
      if (!invoice) throw Errors.notFound();
      const lines = (await c.query(
        `SELECT id, description_fr, description_ar, quantity, unit_price, total_price, line_type
         FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort_order, id`, [invoiceId],
      )).rows;
      return { ...invoice, lines };
    });
  }

  // ── Paiements ─────────────────────────────────────────────────────────────

  async recordCashPayment(userId: string, dto: { invoice_id: string; amount: number; notes?: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const invoice = (await c.query(`SELECT id,child_id,total_amount,paid_amount,status FROM invoices WHERE id=$1 FOR UPDATE`, [dto.invoice_id])).rows[0];
      if (!invoice) throw Errors.notFound();
      if (['paid', 'cancelled'].includes(invoice.status)) throw Errors.invoiceImmutable();
      const due = Number(invoice.total_amount) - Number(invoice.paid_amount);
      if (dto.amount > due) throw new AppError('PAYMENT_EXCEEDS_BALANCE', 'Le paiement dépasse le solde de la facture', 'الدفعة تتجاوز رصيد الفاتورة', 422);
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const payment = (await c.query(
        `INSERT INTO payments(organization_id,reference_number,receipt_number,child_id,amount,method,status,received_at,confirmed_at,notes,created_by)
         VALUES($1,$2,$3,$4,$5,'cash','confirmed',NOW(),NOW(),$6,$7) RETURNING id,reference_number,receipt_number,amount,status`,
        [org, `PAY-${seq}`, `REC-${seq}-${org.slice(0, 8)}`, invoice.child_id, dto.amount, dto.notes ?? null, userId],
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
      return { ...payment, invoice: updated };
    });
  }

  /** Allocation d'un paiement confirmé vers une facture (bornes en base, trigger 023). */
  async allocatePayment(userId: string, paymentId: string, dto: { invoice_id: string; amount_allocated: number }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const payment = (await c.query(`SELECT id,amount,status FROM payments WHERE id=$1 FOR UPDATE`, [paymentId])).rows[0];
      if (!payment) throw Errors.notFound();
      if (payment.status !== 'confirmed') {
        throw new AppError('PAYMENT_NOT_CONFIRMED', 'Seul un paiement confirmé peut être alloué', 'يمكن تخصيص الدفعات المؤكدة فقط', 422);
      }
      const invoice = (await c.query(`SELECT id,status,total_amount,paid_amount FROM invoices WHERE id=$1 FOR UPDATE`, [dto.invoice_id])).rows[0];
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

  async getPayment(paymentId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const payment = (await c.query(
        `SELECT p.*, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name
         FROM payments p JOIN children ch ON ch.id=p.child_id WHERE p.id=$1`, [paymentId],
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
      const r = await c.query(
        `INSERT INTO daily_cash_registers(organization_id,site_id,register_date,opening_balance)
         VALUES($1,$2,$3,$4) ON CONFLICT(site_id,register_date) DO NOTHING RETURNING *`,
        [org, dto.site_id, date, dto.opening_balance ?? 0],
      );
      if (!r.rows[0]) throw new AppError('CASH_REGISTER_ALREADY_OPEN', 'La caisse est déjà ouverte', 'الصندوق مفتوح بالفعل', 409);
      return r.rows[0];
    });
  }

  async closeCashRegister(userId: string, dto: { site_id: string; notes?: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const date = (await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d;
      const register = (await c.query(`SELECT * FROM daily_cash_registers WHERE site_id=$1 AND register_date=$2 FOR UPDATE`, [dto.site_id, date])).rows[0];
      if (!register) throw new AppError('CASH_REGISTER_NOT_OPEN', 'La caisse n’est pas ouverte', 'الصندوق غير مفتوح', 409);
      if (register.closed_at) throw new AppError('CASH_REGISTER_CLOSED', 'La caisse est déjà clôturée', 'الصندوق مغلق بالفعل', 409);
      const total = (await c.query(
        `SELECT COALESCE(SUM(p.amount),0) AS total
         FROM payments p JOIN children ch ON ch.id=p.child_id
         WHERE p.organization_id=$1 AND p.method='cash' AND p.status='confirmed'
           AND ch.site_id=$2 AND (p.confirmed_at AT TIME ZONE 'Africa/Algiers')::date=$3`,
        [org, dto.site_id, date],
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
    requireTenant(this.tenant);
    const invoice = await this.tenant.withTenantConnection(async (c) => {
      const r = await c.query(`SELECT id, organization_id, pdf_url FROM invoices WHERE id=$1`, [invoiceId]);
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
    if (this.pdfStorage.isLocal()) {
      return { kind: 'buffer' as const, buffer: await this.pdfStorage.read(invoice.pdf_url as string), invoice };
    }
    return { kind: 'redirect' as const, url: await this.pdfStorage.presign(invoice.pdf_url as string), invoice };
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
