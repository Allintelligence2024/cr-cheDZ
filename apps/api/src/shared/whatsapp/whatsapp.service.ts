import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../errors';

/**
 * WhatsApp Business API (roadmap v2) — envoi de notifications/relances.
 *
 * Règles d'honnêteté (mêmes que SMS/OTP) :
 * - fournisseur non configuré (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID /
 *   WHATSAPP_API_URL manquants) → 503 WHATSAPP_NOT_CONFIGURED explicite,
 *   JAMAIS de faux « envoyé » ;
 * - l'appel HTTP vers l'API Graph (meta) est RÉEL (fetch, timeout) ;
 * - le canal reste soumis au feature flag `whatsapp_notifications` côté
 *   appelant (notifications) — ce service n'envoie que si on lui demande.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  /** Envoie un message WhatsApp via l'API Graph de Meta (Cloud API). */
  async send(to: string, text: string): Promise<{ message_id: string }> {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneId = this.config.get<string>('WHATSAPP_PHONE_ID');
    const apiUrl = this.config.get<string>('WHATSAPP_API_URL', 'https://graph.facebook.com/v19.0');
    if (!token || !phoneId) {
      throw new AppError(
        'WHATSAPP_NOT_CONFIGURED',
        'Le service WhatsApp n’est pas configuré (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)',
        'خدمة واتساب غير مهيأة (نقص WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)',
        503,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${apiUrl}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Corps d'erreur jamais journalisé (peut contenir des données).
        this.logger.error(`WhatsApp rejeté: HTTP ${res.status} (détail non journalisé)`);
        throw new AppError(
          'WHATSAPP_SEND_FAILED',
          'Le message WhatsApp n’a pas pu être envoyé',
          'تعذر إرسال رسالة واتساب',
          502,
        );
      }
      const body = (await res.json()) as { messages?: Array<{ id?: string }> };
      return { message_id: body.messages?.[0]?.id ?? 'unknown' };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'WHATSAPP_SEND_FAILED',
        'Le service WhatsApp est injoignable, réessayez plus tard',
        'خدمة واتساب غير متاحة، أعد المحاولة لاحقاً',
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
