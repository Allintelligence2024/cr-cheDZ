import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [PrivacyModule, MediaModule],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
