import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrivacyModule } from '../privacy/privacy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { SessionsService } from './sessions.service';
import { TotpService } from './totp.service';
import { SmsService } from '../../shared/sms/sms.service';
import { WhatsAppService } from '../../shared/whatsapp/whatsapp.service';

@Module({
  imports: [
    PrivacyModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'dev_jwt_secret_change_in_prod_minimum_32_chars',
        ),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController, DevicesController],
  providers: [AuthService, SessionsService, DevicesService, TotpService, SmsService, WhatsAppService],
  exports: [SessionsService, TotpService],
})
export class IdentityModule {}
