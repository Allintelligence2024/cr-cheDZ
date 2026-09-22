import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffScheduleService } from './staff-schedule.service';

@Module({
  // R17 : OrganizationsModule exporte FeatureFlagsService, nécessaire au
  // FeatureFlagGuard câblé sur les routes schedule de StaffController.
  imports: [PrivacyModule, OrganizationsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffScheduleService],
})
export class StaffModule {}
