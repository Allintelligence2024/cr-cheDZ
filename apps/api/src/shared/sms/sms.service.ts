import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../errors';

/**
 * Livraison OTP par Twilio. Les identifiants sont exclusivement des variables
 * d'environnement; aucun code OTP ne doit être écrit dans les logs.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');
    if (!sid || !token || !from) {
      this.logger.error('SMS OTP non configuré (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM)');
      throw new AppError('SMS_UNAVAILABLE', 'Le service SMS est momentanément indisponible', 'خدمة الرسائل النصية غير متاحة مؤقتاً', 503);
    }
    const form = new URLSearchParams({ To: phone, From: from, Body: `Crèche DZ — code de connexion : ${code}. Valable 10 minutes.` });
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form,
    });
    if (!response.ok) {
      this.logger.error(`Twilio OTP rejeté: HTTP ${response.status}`);
      throw new AppError('SMS_UNAVAILABLE', 'Le service SMS est momentanément indisponible', 'خدمة الرسائل النصية غير متاحة مؤقتاً', 503);
    }
  }
}
