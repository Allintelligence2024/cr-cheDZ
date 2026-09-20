import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { AttestationsController, ParentAttestationsController } from './attestations.controller';
import { AttestationsService } from './attestations.service';

@Module({
  imports: [PrivacyModule],
  controllers: [AttestationsController, ParentAttestationsController],
  providers: [AttestationsService],
})
export class AttestationsModule {}
