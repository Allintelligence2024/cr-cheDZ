import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  controllers: [PrivacyController],
  providers: [AuditService, PrivacyService],
  exports: [AuditService, PrivacyService],
})
export class PrivacyModule {}
