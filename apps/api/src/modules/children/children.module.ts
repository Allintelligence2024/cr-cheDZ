import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { ChildrenController } from './children.controller';
import { ChildrenService } from './children.service';
import { GuardiansService } from './guardians.service';
import { ImportService } from './import.service';

@Module({
  imports: [PrivacyModule],
  controllers: [ChildrenController],
  providers: [ChildrenService, GuardiansService, ImportService],
})
export class ChildrenModule {}
