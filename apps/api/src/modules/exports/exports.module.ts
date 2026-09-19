import { Module } from '@nestjs/common';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  controllers: [ExportsController],
  providers: [ExportsService, S3ClientService],
})
export class ExportsModule {}
