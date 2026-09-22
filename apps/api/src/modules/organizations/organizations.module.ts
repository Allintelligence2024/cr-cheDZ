import { Module } from '@nestjs/common';
import { EmailService } from '../../shared/email/email.service';
import { InvitationJwtModule } from '../../shared/auth/invitation-jwt.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [PrivacyModule, InvitationJwtModule],
  controllers: [
    OrganizationsController,
    SitesController,
    RoomsController,
    InvitationsController,
    FeatureFlagsController,
  ],
  providers: [
    OrganizationsService,
    SitesService,
    RoomsService,
    InvitationsService,
    FeatureFlagsService,
    EmailService,
  ],
  // R17 (remédiation 2026-09-21, F16) : on exporte FeatureFlagsService pour
  // que les modules enrollment / staff puissent brancher le FeatureFlagGuard
  // sans dupliquer la logique de résolution. Les routes API qui consultent
  // un feature flag sont précisément celles qui n'ont pas d'UI admin-web.
  exports: [FeatureFlagsService],
})
export class OrganizationsModule {}
