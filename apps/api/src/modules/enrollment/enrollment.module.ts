import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';

@Module({
  // R17 : OrganizationsModule exporte FeatureFlagsService, nécessaire au
  // FeatureFlagGuard câblé sur EnrollmentController.
  imports: [PrivacyModule, OrganizationsModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService],
})
export class EnrollmentModule {}
