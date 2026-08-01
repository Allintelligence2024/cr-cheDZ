import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envoi d'emails — abstraction.
 * EMAIL_PROVIDER=none (défaut dev) : les emails sont loggés (le token
 * d'invitation est aussi retourné par l'API en dev pour les tests).
 * Phase 7 : brancher SMTP/SES via notification_queue + worker.
 */
@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  async sendInvitation(to: string, token: string, orgName: string): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    const link = `${appUrl}/accept-invitation?token=${token}`;
    const provider = this.config.get<string>('EMAIL_PROVIDER', 'none');
    if (provider === 'none') {
      // eslint-disable-next-line no-console
      console.log(`[email-dev] Invitation pour ${to} (${orgName}) : ${link}`);
      return;
    }
    // TODO Phase 7 : envoi réel (SMTP/SES) via notification_queue.
    throw new Error(`EMAIL_PROVIDER=${provider} non implémenté (Phase 7)`);
  }
}
