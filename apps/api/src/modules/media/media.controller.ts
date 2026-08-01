import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ListMediaQuery, PresignUploadDto, RegisterMediaDto, UpdateMediaVisibilityDto } from './dto/media.dto';
import { MediaService } from './media.service';

class MediaIdParam {
  @IsUUID()
  id!: string;
}

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('presign-upload')
  @Roles(...STAFF_ROLES)
  async presignUpload(
    @Body() dto: PresignUploadDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ upload_url: string; storage_key: string }> {
    return this.mediaService.presignUpload(user.sub, dto);
  }

  @Post()
  @Roles(...STAFF_ROLES)
  async register(
    @Body() dto: RegisterMediaDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.mediaService.register(user.sub, dto);
  }

  @Get()
  @Roles(...STAFF_ROLES)
  async list(
    @Query() query: ListMediaQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.mediaService.list(user.sub, query.child_id) };
  }

  @Get(':id/download')
  @Roles(...STAFF_ROLES)
  async download(
    @Param() params: MediaIdParam,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
  ): Promise<{ url: string; key: string }> {
    return this.mediaService.downloadUrl(user.sub, params.id, req.ip);
  }

  @Patch(':id/visibility')
  @Roles('super_admin', 'director')
  async setVisibility(
    @Param() params: MediaIdParam,
    @Body() dto: UpdateMediaVisibilityDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.mediaService.setVisibility(user.sub, params.id, dto.is_visible_to_parents);
  }
}
