import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffScheduleService } from './staff-schedule.service';

@Module({
  imports: [PrivacyModule],
  controllers: [StaffController],
  providers: [StaffService, StaffScheduleService],
})
export class StaffModule {}
