import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../errors';

/** Invitation delivery has no real provider yet. Development handoff is explicit;
 * outside development fail closed, rather than expose a token or claim delivery.
 */
@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  assertInvitationDeliveryAvailable(): void {
    if (this.config.get<string>('NODE_ENV') !== 'development'
      || this.config.get<string>('EMAIL_PROVIDER', 'none') !== 'none') {
      throw new AppError('INVITATION_DELIVERY_UNAVAILABLE',
        'L’envoi des invitations n’est pas configuré', 'إرسال الدعوات غير مهيأ', 503);
    }
  }

  async sendInvitation(_to: string, _token: string, _orgName: string): Promise<void> {
    this.assertInvitationDeliveryAvailable();
    // Neither recipient nor bearer link belongs in logs; no delivery was attempted.
    console.log('[email-dev] Simulation d’invitation : aucune transmission, jeton remis au client development');
  }
}
