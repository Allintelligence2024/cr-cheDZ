import { Module } from '@nestjs/common';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { EmailService } from '../../shared/email/email.service';
import { PrivacyModule } from '../privacy/privacy.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentProviderService } from './payment-provider.service';
import { PdfStorageService } from './pdf-storage.service';

@Module({
  imports: [PrivacyModule],
  controllers: [BillingController],
  providers: [BillingService, PaymentProviderService, PdfStorageService, S3ClientService, EmailService],
  exports: [BillingService, PaymentProviderService, PdfStorageService],
})
export class BillingModule {}
