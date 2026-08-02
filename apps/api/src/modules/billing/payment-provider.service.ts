import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

/**
 * Paiement en ligne CIB/Edahabia (roadmap v2) — adaptateur SATIM.
 *
 * Règles d'honnêteté (jamais de faux « payé ») :
 * - feature flag `online_payment` désactivé pour l'organisation → 422
 *   FEATURE_DISABLED ;
 * - fournisseur non configuré (SATIM_MERCHANT_ID/SATIM_SECRET/
 *   SATIM_GATEWAY_URL manquants) → 503 PAYMENT_PROVIDER_NOT_CONFIGURED ;
 * - la requête HTTP vers la passerelle est RÉELLE (fetch, signature
 *   HMAC-SHA256, timeout) ; toute erreur → 502 PAYMENT_GATEWAY_ERROR et
 *   paiement passé en 'failed' ;
 * - la confirmation finale reste le webhook signé/idempotent existant
 *   (billing_webhook_apply, migration 024) : le fournisseur rappelle
 *   POST /billing/webhooks/payment.
 */
@Injectable()
export class PaymentProviderService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Vérifie le flag online_payment (global ou surcharge org) — sous RLS tenant. */
  async assertFeatureEnabled(orgId: string): Promise<void> {
    const flag = await this.tenantContext.withTenantConnection(async (client) => client.query(
      `SELECT COALESCE(
         (SELECT is_enabled FROM feature_flags WHERE flag_key='online_payment' AND organization_id=$1),
         (SELECT is_enabled FROM feature_flags WHERE flag_key='online_payment' AND organization_id IS NULL),
         false) AS enabled`,
      [orgId],
    ));
    if (!flag.rows[0]?.enabled) {
      throw new AppError(
        'FEATURE_DISABLED',
        'Le paiement en ligne n’est pas activé pour votre organisation',
        'الدفع الإلكتروني غير مفعل لمؤسستك',
        422,
      );
    }
  }

  private configOrThrow(): { merchantId: string; secret: string; gatewayUrl: string } {
    const merchantId = this.config.get<string>('SATIM_MERCHANT_ID');
    const secret = this.config.get<string>('SATIM_SECRET');
    const gatewayUrl = this.config.get<string>('SATIM_GATEWAY_URL');
    if (!merchantId || !secret || !gatewayUrl) {
      throw new AppError(
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'La passerelle de paiement n’est pas configurée (SATIM_MERCHANT_ID/SATIM_SECRET/SATIM_GATEWAY_URL)',
        'بوابة الدفع غير مهيأة (نقص بيانات SATIM)',
        503,
      );
    }
    return { merchantId, secret, gatewayUrl };
  }

  /**
   * Crée un paiement en ligne : paiement 'pending' avec external_reference,
   * appel réel à la passerelle (init), réponse { redirect_url, transaction_id }.
   */
  async createOnlinePayment(userId: string, dto: { invoice_id: string; method: 'cib' | 'edahabia' }): Promise<Record<string, unknown>> {
    const orgId = requireTenant(this.tenantContext);
    await this.assertFeatureEnabled(orgId);
    const { merchantId, secret, gatewayUrl } = this.configOrThrow();

    const externalReference = `satim-${randomUUID()}`;
    const payment = await this.tenantContext.withTenantConnection(async (client) => {
      const invoice = (await client.query(
        `SELECT id, child_id, total_amount, paid_amount, status FROM invoices WHERE id=$1 FOR UPDATE`, [dto.invoice_id],
      )).rows[0];
      if (!invoice) throw Errors.notFound();
      if (invoice.status === 'paid' || invoice.status === 'cancelled') throw Errors.invoiceImmutable();
      const due = Number(invoice.total_amount) - Number(invoice.paid_amount);
      const seq = (await client.query(`SELECT next_org_sequence($1) AS n`, [orgId])).rows[0].n;
      const method = dto.method === 'cib' ? 'cib' : 'edahabia';
      const row = (await client.query(
        `INSERT INTO payments (organization_id, reference_number, child_id, amount, method, status,
           external_reference, payment_gateway, created_by)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,'satim',$7)
         RETURNING id, reference_number, amount, method, status, external_reference`,
        [orgId, `ONL-${seq}`, invoice.child_id, due, method, externalReference, userId],
      )).rows[0];
      return row;
    });

    // Appel réel à la passerelle (init) — signature HMAC-SHA256.
    const amount = String(Number(payment.amount).toFixed(2));
    const payload = {
      merchant_id: merchantId,
      amount,
      currency: 'DZD',
      invoice_id: dto.invoice_id,
      reference: externalReference,
    };
    const canonical = `${payload.merchant_id}|${payload.amount}|${payload.currency}|${payload.invoice_id}|${payload.reference}`;
    const signature = createHmac('sha256', secret).update(canonical).digest('hex');
    let gatewayResponse: Record<string, unknown>;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${gatewayUrl}/payment/init`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-satim-signature': signature },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      gatewayResponse = (await res.json()) as Record<string, unknown>;
    } catch (error) {
      // Marquage failed SOUS RLS (withTenantConnection) — la pool brute
      // n'a pas de tenant posé et ne verrait aucune ligne.
      await this.tenantContext.withTenantConnection(async (client) => {
        await client.query(
          `UPDATE payments SET status='failed', gateway_response=$2 WHERE id=$1`,
          [payment.id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })],
        );
      });
      throw new AppError(
        'PAYMENT_GATEWAY_ERROR',
        'La passerelle de paiement est injoignable, réessayez plus tard',
        'بوابة الدفع غير متاحة، أعد المحاولة لاحقاً',
        502,
      );
    }
    const redirectUrl = typeof gatewayResponse.redirect_url === 'string' ? gatewayResponse.redirect_url : null;
    if (!redirectUrl) {
      throw new AppError('PAYMENT_GATEWAY_ERROR', 'Réponse invalide de la passerelle', 'استجابة غير صالحة من بوابة الدفع', 502);
    }
    await this.pool.query(
      `UPDATE payments SET gateway_response=$2 WHERE id=$1`,
      [payment.id, JSON.stringify(gatewayResponse)],
    );
    return { ...payment, redirect_url: redirectUrl, transaction_id: gatewayResponse.transaction_id ?? null };
  }
}
