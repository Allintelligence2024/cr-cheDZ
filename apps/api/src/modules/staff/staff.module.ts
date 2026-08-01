import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [PrivacyModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
