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
  Req,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ChildrenService } from './children.service';
import { CreateChildDto, ListChildrenQuery, MoveRoomDto, UpdateChildDto } from './dto/children.dto';
import {
  CreateEmergencyContactDto,
  CreateGuardianDto,
  CreatePickupDto,
  LinkGuardianDto,
  UpdateGuardianDto,
  UpdatePickupDto,
} from './dto/guardians.dto';
import { ImportChildrenDto, type ImportResult } from './dto/import.dto';
import { GuardiansService } from './guardians.service';
import { ImportService } from './import.service';

class ChildIdParam {
  @IsUUID()
  id!: string;
}

class GuardianIdParam {
  @IsUUID()
  id!: string;
}

const READ_ROLES = ['super_admin', 'director', 'receptionist', 'educator'];
const WRITE_ROLES = ['super_admin', 'director', 'receptionist'];

@Controller('children')
export class ChildrenController {
  constructor(
    private readonly childrenService: ChildrenService,
    private readonly guardiansService: GuardiansService,
    private readonly importService: ImportService,
  ) {}

  // ── Enfants ──────────────────────────────────────────────────────────────

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @Query() query: ListChildrenQuery,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    return this.childrenService.list({
      siteId: query.site_id,
      roomId: query.room_id,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async getById(
    @Param() params: ChildIdParam,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.childrenService.getById(params.id, user.sub, req.ip);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  async create(
    @Body() dto: CreateChildDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.childrenService.create(dto, user.sub);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async update(
    @Param() params: ChildIdParam,
    @Body() dto: UpdateChildDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.childrenService.update(params.id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async softDelete(
    @Param() params: ChildIdParam,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.childrenService.softDelete(params.id, user.sub);
  }

  @Post(':id/move-room')
  @Roles(...WRITE_ROLES)
  async moveRoom(
    @Param() params: ChildIdParam,
    @Body() dto: MoveRoomDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.childrenService.moveRoom(params.id, dto, user.sub);
  }

  // ── Import ───────────────────────────────────────────────────────────────

  @Post('import')
  @Roles('super_admin', 'director', 'receptionist')
  async importRows(
    @Body() dto: ImportChildrenDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ImportResult> {
    return this.importService.importRows(dto.rows, dto.dry_run ?? false, user.sub);
  }

  // ── Responsables ─────────────────────────────────────────────────────────

  @Post('guardians')
  @Roles(...WRITE_ROLES)
  async createGuardian(
    @Body() dto: CreateGuardianDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.createGuardian(dto, user.sub);
  }

  @Get('guardians')
  @Roles(...READ_ROLES)
  async listGuardians(
    @Query('search') search?: string,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.guardiansService.listGuardians(search) };
  }

  @Patch('guardians/:id')
  @Roles(...WRITE_ROLES)
  async updateGuardian(
    @Param() params: GuardianIdParam,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.updateGuardian(params.id, dto, user.sub);
  }

  // ── Liens enfant ↔ responsable ───────────────────────────────────────────

  @Get(':id/guardians')
  @Roles(...READ_ROLES)
  async listChildGuardians(@Param() params: ChildIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.guardiansService.listChildGuardians(params.id) };
  }

  @Post(':id/guardians')
  @Roles(...WRITE_ROLES)
  async linkGuardian(
    @Param() params: ChildIdParam,
    @Body() dto: LinkGuardianDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.linkGuardian(params.id, dto, user.sub);
  }

  @Delete(':id/guardians/:gid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async unlinkGuardian(
    @Param('id') id: string,
    @Param('gid') gid: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.guardiansService.unlinkGuardian(id, gid, user.sub);
  }

  // ── Contacts d'urgence ───────────────────────────────────────────────────

  @Get(':id/emergency-contacts')
  @Roles(...READ_ROLES)
  async listEmergencyContacts(@Param() params: ChildIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.guardiansService.listEmergencyContacts(params.id) };
  }

  @Post(':id/emergency-contacts')
  @Roles(...WRITE_ROLES)
  async createEmergencyContact(
    @Param() params: ChildIdParam,
    @Body() dto: CreateEmergencyContactDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.createEmergencyContact(params.id, dto, user.sub);
  }

  @Delete(':id/emergency-contacts/:cid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async deleteEmergencyContact(
    @Param('id') id: string,
    @Param('cid') cid: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.guardiansService.deleteEmergencyContact(id, cid, user.sub);
  }

  // ── Personnes autorisées à récupérer ─────────────────────────────────────

  @Get(':id/pickups')
  @Roles(...READ_ROLES)
  async listPickups(@Param() params: ChildIdParam): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.guardiansService.listPickups(params.id) };
  }

  @Post(':id/pickups')
  @Roles(...WRITE_ROLES)
  async createPickup(
    @Param() params: ChildIdParam,
    @Body() dto: CreatePickupDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.createPickup(params.id, dto, user.sub);
  }

  @Patch(':id/pickups/:pid')
  @Roles(...WRITE_ROLES)
  async updatePickup(
    @Param('id') id: string,
    @Param('pid') pid: string,
    @Body() dto: UpdatePickupDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.guardiansService.updatePickup(id, pid, dto, user.sub);
  }
}
