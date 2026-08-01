import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/organizations.dto';
import { OrganizationsService } from './organizations.service';

class OrgIdParam {
  @IsUUID()
  id!: string;
}

@Controller('organizations')
@Roles('super_admin')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.organizationsService.create(dto, user.sub);
  }

  @Get()
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.organizationsService.list() };
  }

  @Get(':id')
  async getById(@Param() params: OrgIdParam): Promise<Record<string, unknown>> {
    return this.organizationsService.getById(params.id);
  }

  @Patch(':id')
  async update(
    @Param() params: OrgIdParam,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.organizationsService.update(params.id, dto, user.sub);
  }
}
