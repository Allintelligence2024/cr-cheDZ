import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import {
  CoverageQuery,
  CreateShiftDto,
  CreateStaffAssignmentDto,
  GenerateWeekDto,
  ScheduleQuery,
  CreateStaffDocumentDto,
  CreateStaffDto,
  StaffAttendanceDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';
import { StaffScheduleService } from './staff-schedule.service';

class StaffIdParam {
  @IsUUID()
  id!: string;
}

class ExpiringQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

const WRITE_ROLES = ['super_admin', 'director'] as const;
// C1 (audit 2026-09) — matrice d'autorisation en lecture :
// la direction et la comptabilité gèrent le personnel ; l'éducateur, le
// parent et les autres rôles n'ont AUCUN accès au module staff. Les champs
// sensibles (national_id, cnas_number, base_salary, phone, notes, contacts
// d'urgence) ne sont JAMAIS exposés par ces routes — la paie les lit
// directement en base (payroll.service) sous les rôles RH.
const READ_ROLES = ['super_admin', 'director', 'accountant'] as const;

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService, private readonly schedule: StaffScheduleService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.list() };
  }

  // ── P2-5 : planning ──────────────────────────────────────────────────────
  @Get('schedule')
  @Roles(...READ_ROLES)
  async scheduleList(@Query() q: ScheduleQuery): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.schedule.list(q.from, q.to, q.site_id) };
  }

  @Get('schedule/coverage')
  @Roles(...READ_ROLES)
  async scheduleCoverage(@Query() q: CoverageQuery) {
    return this.schedule.coverage(q.date, q.site_id);
  }

  @Post('schedule/shifts')
  @Roles(...WRITE_ROLES)
  async createShift(@Body() dto: CreateShiftDto, @CurrentUser() user: CurrentUserPayload) {
    return this.schedule.createShift(user.sub, dto);
  }

  @Delete('schedule/shifts/:id')
  @Roles(...WRITE_ROLES)
  async deleteShift(@Param() params: StaffIdParam, @CurrentUser() user: CurrentUserPayload) {
    return this.schedule.deleteShift(user.sub, params.id);
  }

  @Post('schedule/generate-week')
  @Roles(...WRITE_ROLES)
  async generateWeek(@Body() dto: GenerateWeekDto, @CurrentUser() user: CurrentUserPayload) {
    return this.schedule.generateWeek(user.sub, dto);
  }

  @Get('documents/expiring')
  @Roles(...READ_ROLES)
  async expiring(@Query() query: ExpiringQuery): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.listExpiringDocuments(query.days ?? 30) };
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async getById(@Param() params: StaffIdParam): Promise<Record<string, unknown>> {
    return this.staffService.getById(params.id);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.staffService.create(dto, user.sub);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async update(
    @Param() params: StaffIdParam,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.staffService.update(params.id, dto, user.sub);
  }

  // ── Documents ────────────────────────────────────────────────────────────

  @Get(':id/documents')
  @Roles(...READ_ROLES)
  async documents(@Param() params: StaffIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.listDocuments(params.id) };
  }

  @Post(':id/documents')
  @Roles(...WRITE_ROLES)
  async createDocument(
    @Param() params: StaffIdParam,
    @Body() dto: CreateStaffDocumentDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.staffService.createDocument(params.id, dto, user.sub);
  }

  // ── Affectations ─────────────────────────────────────────────────────────

  @Get(':id/assignments')
  @Roles(...READ_ROLES)
  async assignments(@Param() params: StaffIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.listAssignments(params.id) };
  }

  @Post(':id/assignments')
  @Roles(...WRITE_ROLES)
  async createAssignment(
    @Param() params: StaffIdParam,
    @Body() dto: CreateStaffAssignmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.staffService.createAssignment(params.id, dto, user.sub);
  }

  @Post(':id/assignments/:aid/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async endAssignment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.staffService.endAssignment(id, aid, user.sub);
  }

  // ── Pointage ─────────────────────────────────────────────────────────────

  @Get(':id/attendance')
  @Roles(...READ_ROLES)
  async attendance(@Param() params: StaffIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.listAttendance(params.id) };
  }

  @Post(':id/attendance')
  @Roles(...WRITE_ROLES)
  async upsertAttendance(
    @Param() params: StaffIdParam,
    @Body() dto: StaffAttendanceDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.staffService.upsertAttendance(params.id, dto, user.sub);
  }
}
