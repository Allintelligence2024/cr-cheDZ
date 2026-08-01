import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { AttendanceService } from './attendance.service';
import {
  AttendanceSummaryQuery,
  CheckInDto,
  CheckOutDto,
  CorrectAttendanceDto,
  MarkAbsentDto,
} from './dto/attendance.dto';

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @Roles(...STAFF_ROLES)
  async checkIn(@Body() dto: CheckInDto, @CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.attendanceService.checkIn(user.sub, dto);
  }

  @Post('check-out')
  @Roles(...STAFF_ROLES)
  async checkOut(@Body() dto: CheckOutDto, @CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.attendanceService.checkOut(user.sub, dto);
  }

  @Post('mark-absent')
  @Roles(...STAFF_ROLES)
  async markAbsent(@Body() dto: MarkAbsentDto, @CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.attendanceService.markAbsent(user.sub, dto);
  }

  @Post('correct')
  @Roles(...STAFF_ROLES)
  async correct(@Body() dto: CorrectAttendanceDto, @CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.attendanceService.correct(user.sub, dto);
  }

  @Get('summary')
  @Roles(...STAFF_ROLES)
  async summary(@Query() query: AttendanceSummaryQuery): Promise<{ date: string; items: Array<Record<string, unknown>> }> {
    return this.attendanceService.summary(query.room_id, query.date);
  }
}
