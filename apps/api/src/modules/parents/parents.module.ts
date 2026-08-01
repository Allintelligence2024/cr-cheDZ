import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BillingModule } from '../billing/billing.module';
import { MediaModule } from '../media/media.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [AttendanceModule, MediaModule, BillingModule, PrivacyModule],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
