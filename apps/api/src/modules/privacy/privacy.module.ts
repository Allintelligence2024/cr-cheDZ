import { Module } from '@nestjs/common';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { AuditService } from './audit.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  controllers: [PrivacyController],
  providers: [AuditService, PrivacyService, S3ClientService],
  exports: [AuditService, PrivacyService],
})
export class PrivacyModule {}
