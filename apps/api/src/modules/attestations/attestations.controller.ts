import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { AttestationsService } from './attestations.service';
import { AttestationIdParam, IssueAttestationDto } from './dto/attestations.dto';

const sendPdf = (res: Response, r: { buffer: Buffer; filename: string }) => {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${r.filename}"`);
  res.send(r.buffer);
};

/** P2-6 : attestations annuelles de frais de garde. */
@Controller('attestations')
export class AttestationsController {
  constructor(private readonly attestations: AttestationsService) {}

  @Post()
  @Roles('director', 'accountant')
  issue(@CurrentUser() u: CurrentUserPayload, @Body() d: IssueAttestationDto) {
    return this.attestations.issue(u.sub, d);
  }

  @Get()
  @Roles('director', 'accountant')
  list(@Query('child_id') childId?: string) {
    return this.attestations.list(childId);
  }

  @Get(':attestationId/pdf')
  @Roles('director', 'accountant')
  async pdf(@CurrentUser() u: CurrentUserPayload, @Param() p: AttestationIdParam, @Req() req: Request, @Res() res: Response) {
    sendPdf(res, await this.attestations.pdf(u.sub, p.attestationId, { ipAddress: req.ip }));
  }
}

/** Côté parent : lecture seule, permission can_receive_invoices. */
@Controller('parent/attestations')
@Roles('parent_primary', 'parent_secondary')
export class ParentAttestationsController {
  constructor(private readonly attestations: AttestationsService) {}

  @Get()
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.attestations.listForParent(u.sub);
  }

  @Get(':attestationId/pdf')
  async pdf(@CurrentUser() u: CurrentUserPayload, @Param() p: AttestationIdParam, @Req() req: Request, @Res() res: Response) {
    sendPdf(res, await this.attestations.pdf(u.sub, p.attestationId, { parentUserId: u.sub, ipAddress: req.ip }));
  }
}
