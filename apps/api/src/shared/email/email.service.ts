import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { AppError } from '../errors';
import { invitationEmail, paymentReceiptEmail } from './email-templates';

export type EmailProvider = 'none' | 'smtp';

/**
 * Livraison transactionnelle des emails (P0 — audit continu 2026-09).
 *
 * Fournisseurs (`EMAIL_PROVIDER`) :
 * - `none`  : remise en main propre development uniquement (le jeton est
 *             retourné au client ; aucun envoi). Tout autre environnement
 *             échoue fermé — 503 INVITATION_DELIVERY_UNAVAILABLE.
 * - `smtp`  : envoi réel via nodemailer (tout environnement). La
 *             configuration doit être complète (SMTP_HOST + SMTP_FROM),
 *             sinon 503 avant toute écriture métier ; un échec d'envoi après
 *             retries répond 502 EMAIL_DELIVERY_FAILED — jamais de jeton
 *             exposé pour masquer une non-livraison.
 *
 * Retries : 3 tentatives (délais 500 ms / 2 s), timeouts courts pour ne pas
 * suspendre la requête HTTP si le relais SMTP est défaillant.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private cachedTransport: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  provider(): EmailProvider {
    const raw = this.config.get<string>('EMAIL_PROVIDER', 'none').toLowerCase();
    return raw === 'smtp' ? 'smtp' : 'none';
  }

  /** Configuration SMTP complète ? (hôte + expéditeur) */
  smtpConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST') && this.config.get<string>('SMTP_FROM'),
    );
  }

  /**
   * Garde fail-closed appelée AVANT toute écriture métier : le transport doit
   * être réellement disponible, sinon 503 sans effet de bord ni fuite de jeton.
   */
  assertInvitationDeliveryAvailable(): void {
    if (this.provider() === 'smtp') {
      if (!this.smtpConfigured()) {
        throw new AppError(
          'INVITATION_DELIVERY_UNAVAILABLE',
          'L’envoi des invitations n’est pas configuré (SMTP_HOST/SMTP_FROM manquants)',
          'إرسال الدعوات غير مهيأ',
          503,
        );
      }
      return;
    }
    if (this.config.get<string>('NODE_ENV') !== 'development') {
      throw new AppError(
        'INVITATION_DELIVERY_UNAVAILABLE',
        'L’envoi des invitations n’est pas configuré',
        'إرسال الدعوات غير مهيأ',
        503,
      );
    }
  }

  /** Disponibilité silencieuse (pour les envois best-effort type reçu). */
  private deliveryAvailable(): boolean {
    if (this.provider() === 'smtp') return this.smtpConfigured();
    return this.config.get<string>('NODE_ENV') === 'development';
  }

  protected buildTransport(): Transporter {
    if (this.cachedTransport) return this.cachedTransport;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.cachedTransport = createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT', '587')),
      secure: this.config.get<string>('SMTP_SECURE', 'false') === 'true',
      ...(user && pass ? { auth: { user, pass } } : {}),
      pool: true,
      connectionTimeout: 5_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return this.cachedTransport;
  }

  /** Envoi avec retries (3 tentatives, backoff 500 ms / 2 s). */
  async send(to: string, subject: string, html: string, text: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');
    const delays = [500, 2000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await this.buildTransport().sendMail({ from, to, subject, html, text });
        return;
      } catch (error) {
        this.logger.error(
          `Échec envoi email tentative ${attempt + 1}/${delays.length + 1} (destinataire non logué) : ${String((error as Error)?.message ?? error)}`,
        );
        if (attempt < delays.length) await new Promise(r => setTimeout(r, delays[attempt]));
      }
    }
    throw new AppError(
      'EMAIL_DELIVERY_FAILED',
      'L’envoi de l’email a échoué, veuillez réessayer',
      'فشل إرسال البريد الإلكتروني، يرجى المحاولة مرة أخرى',
      502,
    );
  }

  /** Invitation d'un membre : lien d'acceptation signé 7 j. */
  async sendInvitation(to: string, token: string, orgName: string): Promise<void> {
    this.assertInvitationDeliveryAvailable();
    if (this.provider() === 'none') {
      // Ni le destinataire ni le lien ne doivent figurer dans les logs.
      this.logger.log('[email-dev] Simulation d’invitation : aucune transmission, jeton remis au client development');
      return;
    }
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    const acceptUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
    const { subject, html, text } = invitationEmail({ orgName, acceptUrl });
    await this.send(to, subject, html, text);
  }

  /**
   * Reçu de paiement — best-effort : ne bloque jamais l'encaissement.
   * Silencieux si le transport n'est pas disponible.
   */
  async sendPaymentReceipt(input: {
    to: string;
    orgName: string;
    receiptNumber: string;
    amount: number;
    method: string;
  }): Promise<void> {
    if (!this.deliveryAvailable()) return;
    try {
      if (this.provider() === 'none') {
        this.logger.log('[email-dev] Simulation de reçu de paiement : aucune transmission');
        return;
      }
      const { subject, html, text } = paymentReceiptEmail(input);
      await this.send(input.to, subject, html, text);
    } catch (error) {
      this.logger.warn(`Reçu de paiement non envoyé (non bloquant) : ${String((error as Error)?.message ?? error)}`);
    }
  }
}
