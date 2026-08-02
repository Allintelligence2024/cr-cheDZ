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
    void appUrl; void token; // le lien complet (avec jeton) n'est construit que par le fournisseur réel
    const provider = this.config.get<string>('EMAIL_PROVIDER', 'none');
    if (provider === 'none') {
      // Mode dev : le jeton est retourné par l'API (invitation_token) —
      // JAMAIS journalisé (le lien contient le jeton signé).
      // eslint-disable-next-line no-console
      console.log(`[email-dev] Invitation envoyée à ${to} (${orgName}) — jeton non journalisé`);
      return;
    }
    // TODO Phase 7 : envoi réel (SMTP/SES) via notification_queue.
    throw new Error(`EMAIL_PROVIDER=${provider} non implémenté (Phase 7)`);
  }
}
