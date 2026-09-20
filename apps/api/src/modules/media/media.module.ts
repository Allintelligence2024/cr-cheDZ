import { Module } from '@nestjs/common';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { PrivacyModule } from '../privacy/privacy.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';

@Module({
  imports: [PrivacyModule],
  controllers: [MediaController],
  providers: [MediaService, StorageService, S3ClientService],
  exports: [MediaService, StorageService, S3ClientService],
})
export class MediaModule {}
