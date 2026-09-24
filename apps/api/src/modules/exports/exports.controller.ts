import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { sendStorageObject } from '../../shared/storage/object-stream';
import { CreateExportDto, ExportIdParam } from './dto/exports.dto';
import { ExportsService } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /** Demande d'export Excel (présences ou factures) — job worker asynchrone. */
  @Post()
  @Roles('director', 'accountant', 'super_admin')
  request(@Body() dto: CreateExportDto, @CurrentUser() u: CurrentUserPayload) {
    return this.exports.request(u.sub, dto);
  }

  @Get()
  @Roles('director', 'accountant', 'super_admin')
  list() {
    return this.exports.list();
  }

  @Get(':id/download')
  @Roles('director', 'accountant', 'super_admin')
  async download(@Param() p: ExportIdParam, @Req() req: Request, @Res() res: Response) {
    // LOT 2 (P0 F5) : flux same-origin (plus de redirection vers MinIO).
    const result = await this.exports.download(p.id);
    sendStorageObject(res, req, result.object, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: result.filename,
      inline: false,
      onStreamError: {
        code: 'EXPORT_FILE_MISSING',
        messageFr: 'Le fichier d’export est introuvable sur le stockage',
        messageAr: 'ملف التصدير غير موجود في التخزين',
      },
    });
  }
}
