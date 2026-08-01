import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { AppError } from '../../shared/errors';
import {
  AllocatePaymentDto, CloseCashRegisterDto, ContractIdParam, CreateContractDto,
  GenerateInvoiceDto, InvoiceIdParam, OpenCashRegisterDto, PaymentIdParam,
  RecordCashPaymentDto,
} from './dto/billing.dto';
import { BillingService } from './billing.service';

interface WebhookPayload {
  external_reference: string;
  invoice_id: string;
  amount: number;
  gateway?: string;
  paid_at?: string;
  notes?: string;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // ── Contrats ──────────────────────────────────────────────────────────────

  @Post('contracts')
  @Roles('director', 'accountant')
  contract(@CurrentUser() u: CurrentUserPayload, @Body() d: CreateContractDto) {
    return this.billing.createContract(u.sub, d);
  }

  @Get('contracts')
  @Roles('director', 'accountant')
  contracts(@Query('child_id') childId?: string) {
    return this.billing.listContracts(childId);
  }

  @Get('contracts/:contractId')
  @Roles('director', 'accountant')
  contractDetail(@Param() p: ContractIdParam) {
    return this.billing.getContract(p.contractId);
  }

  // ── Factures ──────────────────────────────────────────────────────────────

  @Post('invoices/generate')
  @Roles('director', 'accountant')
  invoice(@CurrentUser() u: CurrentUserPayload, @Body() d: GenerateInvoiceDto) {
    return this.billing.generateInvoice(u.sub, d);
  }

  @Get('invoices')
  @Roles('director', 'accountant')
  invoices(@Query('child_id') childId?: string) {
    return this.billing.listInvoices(childId);
  }

  @Get('invoices/:invoiceId')
  @Roles('director', 'accountant')
  invoiceDetail(@Param() p: InvoiceIdParam) {
    return this.billing.getInvoice(p.invoiceId);
  }

  @Get('invoices/:invoiceId/pdf')
  @Roles('director', 'accountant')
  async invoicePdf(@CurrentUser() u: CurrentUserPayload, @Param() p: InvoiceIdParam, @Req() req: Request, @Res() res: Response) {
    const result = await this.billing.invoicePdf(u.sub, p.invoiceId, req.ip);
    if (result.kind === 'redirect') return res.redirect(HttpStatus.FOUND, result.url);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${result.invoice.invoice_number ?? 'facture'}.pdf"`);
    res.send(result.buffer);
  }

  // ── Paiements ─────────────────────────────────────────────────────────────

  @Post('payments/cash')
  @Roles('director', 'accountant')
  cash(@CurrentUser() u: CurrentUserPayload, @Body() d: RecordCashPaymentDto) {
    return this.billing.recordCashPayment(u.sub, d);
  }

  @Get('payments')
  @Roles('director', 'accountant')
  payments(@Query('child_id') childId?: string) {
    return this.billing.listPayments(childId);
  }

  @Get('payments/:paymentId')
  @Roles('director', 'accountant')
  paymentDetail(@Param() p: PaymentIdParam) {
    return this.billing.getPayment(p.paymentId);
  }

  @Post('payments/:paymentId/allocate')
  @Roles('director', 'accountant')
  allocate(@CurrentUser() u: CurrentUserPayload, @Param() p: PaymentIdParam, @Body() d: AllocatePaymentDto) {
    return this.billing.allocatePayment(u.sub, p.paymentId, d);
  }

  // ── Caisse quotidienne ────────────────────────────────────────────────────

  @Post('cash-register/open')
  @Roles('director', 'accountant')
  openCash(@CurrentUser() u: CurrentUserPayload, @Body() d: OpenCashRegisterDto) {
    return this.billing.openCashRegister(u.sub, d);
  }

  @Post('cash-register/close')
  @Roles('director', 'accountant')
  closeCash(@CurrentUser() u: CurrentUserPayload, @Body() d: CloseCashRegisterDto) {
    return this.billing.closeCashRegister(u.sub, d);
  }

  @Get('cash-registers')
  @Roles('director', 'accountant')
  cashRegisters(@Query('site_id') siteId?: string) {
    return this.billing.listCashRegisters(siteId);
  }

  // ── Webhook de paiement (signé, idempotent) ───────────────────────────────

  /**
   * Webhook fournisseur : la signature HMAC-SHA256 hex (en-tête
   * `x-payment-signature`) couvre le corps brut exact tel qu'envoyé ;
   * PAYMENT_WEBHOOK_SECRET doit être configuré. Sans secret → 503 explicite
   * (intégration déclarée non configurée, jamais de faux statut).
   */
  @Public()
  @Post('webhooks/payment')
  @HttpCode(HttpStatus.OK)
  async paymentWebhook(@Req() req: Request): Promise<unknown> {
    const secret = this.billing.webhookSecret();
    if (!secret) {
      throw new AppError(
        'PAYMENT_WEBHOOK_NOT_CONFIGURED',
        'Le webhook de paiement n’est pas configuré (PAYMENT_WEBHOOK_SECRET manquant)',
        'لم يتم تكوين webhook الدفع (نقص PAYMENT_WEBHOOK_SECRET)',
        503,
      );
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signature = req.headers['x-payment-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new AppError('PAYMENT_WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook manquante', 'توقيع webhook مفقود', 401);
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = Buffer.from(signature);
    if (provided.length !== Buffer.from(expected).length || !timingSafeEqual(provided, Buffer.from(expected))) {
      throw new AppError('PAYMENT_WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 'توقيع webhook غير صالح', 401);
    }
    const payload = this.parseWebhookPayload(req.body);
    return this.billing.applyWebhookPayment(payload);
  }

  private parseWebhookPayload(body: unknown): WebhookPayload {
    const raw = (typeof body === 'string' ? JSON.parse(body) : body) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') throw new AppError('PAYMENT_WEBHOOK_INVALID', 'Corps de webhook invalide', 'محتوى webhook غير صالح', 400);
    const { external_reference, invoice_id, amount, gateway, paid_at, notes } = raw;
    if (typeof external_reference !== 'string' || external_reference.length === 0) {
      throw new AppError('PAYMENT_WEBHOOK_INVALID', 'external_reference requis', 'external_reference مطلوب', 400);
    }
    if (typeof invoice_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice_id)) {
      throw new AppError('PAYMENT_WEBHOOK_INVALID', 'invoice_id invalide', 'invoice_id غير صالح', 400);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new AppError('PAYMENT_WEBHOOK_INVALID', 'Montant invalide', 'مبلغ غير صالح', 400);
    }
    return {
      external_reference,
      invoice_id,
      amount,
      gateway: typeof gateway === 'string' ? gateway : undefined,
      paid_at: typeof paid_at === 'string' ? paid_at : undefined,
      notes: typeof notes === 'string' ? notes : undefined,
    };
  }
}
