import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InvitationJwtModule } from '../../shared/auth/invitation-jwt.module';
import { DEFAULT_JWT_SECRET } from '../../shared/auth/jwt-token-options';
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
    InvitationJwtModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', DEFAULT_JWT_SECRET),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController, DevicesController],
  providers: [AuthService, SessionsService, DevicesService, TotpService, SmsService, WhatsAppService],
  exports: [SessionsService, TotpService],
})
export class IdentityModule {}
