import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateCameraDto, ListClipsQuery, PresignClipDto, RegisterClipDto, UpdateCameraDto } from './dto/video.dto';
import { VideoService } from './video.service';

class IdParam {
  @IsUUID()
  id!: string;
}

/**
 * Vidéosurveillance (roadmap v2 — post-DPIA, loi 25-11).
 * Direction uniquement : ni les éducateurs ni les parents n'ont accès aux
 * images (DPIA §5) ; tout visionnage est journalisé dans audit_logs.
 */
const VIDEO_ROLES = ['director', 'super_admin'] as const;

@Controller('video')
export class VideoController {
  constructor(private readonly video: VideoService) {}

  // ── Caméras ───────────────────────────────────────────────────────────────

  @Post('cameras')
  @Roles(...VIDEO_ROLES)
  createCamera(@Body() dto: CreateCameraDto, @CurrentUser() u: CurrentUserPayload) {
    return this.video.createCamera(u.sub, dto);
  }

  @Get('cameras')
  @Roles(...VIDEO_ROLES)
  listCameras() {
    return this.video.listCameras();
  }

  @Patch('cameras/:id')
  @Roles(...VIDEO_ROLES)
  updateCamera(@Param() p: IdParam, @Body() dto: UpdateCameraDto, @CurrentUser() u: CurrentUserPayload) {
    return this.video.updateCamera(p.id, u.sub, dto);
  }

  // ── Extraits (clips DVR/NVR) ─────────────────────────────────────────────

  @Post('clips/presign-upload')
  @Roles(...VIDEO_ROLES)
  presignUpload(@Body() dto: PresignClipDto, @CurrentUser() u: CurrentUserPayload) {
    return this.video.presignClipUpload(u.sub, dto);
  }

  @Post('clips')
  @Roles(...VIDEO_ROLES)
  registerClip(@Body() dto: RegisterClipDto, @CurrentUser() u: CurrentUserPayload) {
    return this.video.registerClip(u.sub, dto);
  }

  @Get('clips')
  @Roles(...VIDEO_ROLES)
  listClips(@Query() query: ListClipsQuery) {
    return this.video.listClips(query);
  }

  /** URL de visionnage (signée S3 ou endpoint local) — visionnage journalisé. */
  @Get('clips/:id/download')
  @Roles(...VIDEO_ROLES)
  download(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload, @Req() req: Request) {
    return this.video.downloadUrl(p.id, u.sub, req.ip);
  }

  /** Backend local (dev/test) : flux binaire réel — visionnage journalisé. */
  @Get('clips/:id/content')
  @Roles(...VIDEO_ROLES)
  async content(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { buffer, mimeType } = await this.video.streamContent(p.id, u.sub, req.ip);
    res.setHeader('content-type', mimeType);
    res.setHeader('content-length', buffer.length);
    res.end(buffer);
  }
}
