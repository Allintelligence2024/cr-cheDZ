import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DEFAULT_JWT_SECRET, deriveInvitationSecret } from './jwt-token-options';

/**
 * JwtService dédié aux tokens d'invitation (secret dérivé, 7 j).
 *
 * Fourni sous un token d'injection dédié (INVITATION_JWT_SERVICE) pour ne
 * jamais être confondu avec le JwtService des access tokens (JWT_SECRET) :
 * un token signé par l'un ne peut pas être vérifié par l'autre.
 * Consommateurs : InvitationsService (signature) et AuthService.acceptInvitation
 * (vérification).
 */
export const INVITATION_JWT_SERVICE = 'INVITATION_JWT_SERVICE';

@Global()
@Module({
  providers: [
    {
      provide: INVITATION_JWT_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new JwtService({
          secret: deriveInvitationSecret(config.get<string>('JWT_SECRET', DEFAULT_JWT_SECRET)),
          signOptions: { expiresIn: '7d' },
        }),
    },
  ],
  exports: [INVITATION_JWT_SERVICE],
})
export class InvitationJwtModule {}
