import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PdfStorageService } from './pdf-storage.service';

@Module({
  imports: [PrivacyModule],
  controllers: [BillingController],
  providers: [BillingService, PdfStorageService],
  exports: [BillingService, PdfStorageService],
})
export class BillingModule {}
