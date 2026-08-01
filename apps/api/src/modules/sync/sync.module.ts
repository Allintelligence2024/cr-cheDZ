import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { JournalModule } from '../journal/journal.module';
import { MediaModule } from '../media/media.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AttendanceModule, JournalModule, MediaModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
