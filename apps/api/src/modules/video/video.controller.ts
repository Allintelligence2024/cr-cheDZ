import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { sendStorageObject } from '../../shared/storage/object-stream';
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

  /** Chemin de visionnage same-origin (LOT 2 : plus d'URL signée) — journalisé. */
  @Get('clips/:id/download')
  @Roles(...VIDEO_ROLES)
  download(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload, @Req() req: Request) {
    return this.video.downloadUrl(p.id, u.sub, req.ip);
  }

  /**
   * Flux binaire réel du clip (local ou S3, LOT 2) — visionnage journalisé.
   *
   * E2 : le clip est streamé (plus de buffer complet en mémoire) ; un fichier
   * disparu entre la garde et la lecture produit un 404 propre si rien n'est
   * encore parti, sinon une coupure de connexion — jamais un 200 vide.
   */
  @Get('clips/:id/content')
  @Roles(...VIDEO_ROLES)
  async content(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { stream, mimeType, size } = await this.video.streamContent(p.id, u.sub, req.ip);
    sendStorageObject(res, req, { stream, contentType: mimeType, contentLength: size }, {
      inline: true,
      filename: `clip-${p.id}.mp4`,
      onStreamError: {
        code: 'CLIP_FILE_MISSING',
        messageFr: 'Fichier du clip introuvable sur le stockage',
        messageAr: 'ملف المقطع غير موجود في التخزين',
      },
    });
  }
}
