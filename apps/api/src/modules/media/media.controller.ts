import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { sendStorageObject } from '../../shared/storage/object-stream';
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
    // LOT 2 (P0 F5) : l'API ne rend PLUS d'URL signée S3 (inexploitable :
    // MinIO est lié à 127.0.0.1 en production). `url` est un chemin
    // same-origin à appeler avec le JWT — voir `content` ci-dessous.
    return this.mediaService.downloadUrl(user.sub, params.id, req.ip);
  }

  /**
   * Contenu binaire — flux same-origin (photos, documents).
   * Autorisation et journalisation identiques à `download` (RLS + rôle +
   * media_access_logs + carnet d'accès loi 25-11).
   */
  @Get(':id/content')
  @Roles(...STAFF_ROLES)
  async content(
    @Param() params: MediaIdParam,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { object, mimeType, filename } = await this.mediaService.streamContent(user.sub, params.id, req.ip);
    sendStorageObject(res, req, object, {
      contentType: mimeType,
      filename: filename ?? undefined,
      inline: true,
      onStreamError: {
        code: 'MEDIA_CONTENT_MISSING',
        messageFr: 'Le fichier du média est introuvable sur le stockage',
        messageAr: 'ملف الوسائط غير موجود في التخزين',
      },
    });
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
