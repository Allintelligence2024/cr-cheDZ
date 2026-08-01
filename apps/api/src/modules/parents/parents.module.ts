import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MediaModule } from '../media/media.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({ imports: [AttendanceModule, MediaModule], controllers: [ParentsController], providers: [ParentsService] })
export class ParentsModule {}
