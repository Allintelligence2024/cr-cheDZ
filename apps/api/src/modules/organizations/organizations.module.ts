import { Module } from '@nestjs/common';
import { EmailService } from '../../shared/email/email.service';
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
  imports: [PrivacyModule],
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
})
export class OrganizationsModule {}
