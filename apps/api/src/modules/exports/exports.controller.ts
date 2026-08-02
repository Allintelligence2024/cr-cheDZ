import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
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
  async download(@Param() p: ExportIdParam, @Res() res: Response) {
    const result = await this.exports.download(p.id);
    if (result.kind === 'redirect') return res.redirect(HttpStatus.FOUND, result.url);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  }
}
