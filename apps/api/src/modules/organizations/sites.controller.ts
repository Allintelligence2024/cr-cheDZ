import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateSiteDto, UpdateSiteDto } from './dto/organizations.dto';
import { SitesService } from './sites.service';

class SiteIdParam {
  @IsUUID()
  id!: string;
}

@Controller('sites')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.sitesService.list() };
  }

  @Get(':id')
  async getById(@Param() params: SiteIdParam): Promise<Record<string, unknown>> {
    return this.sitesService.getById(params.id);
  }

  @Post()
  @Roles('super_admin', 'director')
  async create(
    @Body() dto: CreateSiteDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.sitesService.create(dto, user.sub);
  }

  @Patch(':id')
  @Roles('super_admin', 'director')
  async update(
    @Param() params: SiteIdParam,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.sitesService.update(params.id, dto, user.sub);
  }
}
