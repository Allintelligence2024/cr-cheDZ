import {
  Body,
  Controller,
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
  CreateStaffAssignmentDto,
  CreateStaffDocumentDto,
  CreateStaffDto,
  StaffAttendanceDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

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

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.list() };
  }

  @Get('documents/expiring')
  async expiring(@Query() query: ExpiringQuery): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.staffService.listExpiringDocuments(query.days ?? 30) };
  }

  @Get(':id')
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
