import { Body, Controller, Get, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { ChildIdParam, InvoiceIdParam, PaymentIdParam, ReportAbsenceDto, SaveConsentDto, SaveNotificationPreferenceDto } from './dto/parent.dto';
import { ParentsService } from './parents.service';

@Controller('parent')
export class ParentsController {
  constructor(private readonly parents: ParentsService) {}

  @Get('children') children(@CurrentUser() u: CurrentUserPayload) { return this.parents.children(u.sub); }
  @Get('children/:childId/feed') feed(@CurrentUser() u: CurrentUserPayload, @Param() p: ChildIdParam) { return this.parents.feed(u.sub, p.childId); }
  @Post('absence') absence(@CurrentUser() u: CurrentUserPayload, @Body() dto: ReportAbsenceDto) { return this.parents.reportAbsence(u.sub, dto.child_id, dto.reason); }
  @Get('children/:childId/consents') consents(@CurrentUser() u: CurrentUserPayload, @Param() p: ChildIdParam) { return this.parents.consents(u.sub, p.childId); }
  @Post('consents') consent(@CurrentUser() u: CurrentUserPayload, @Body() dto: SaveConsentDto) { return this.parents.saveConsent(u.sub, dto); }
  @Get('notification-preferences') preferences(@CurrentUser() u: CurrentUserPayload) { return this.parents.preferences(u.sub); }
  @Post('notification-preferences') preference(@CurrentUser() u: CurrentUserPayload, @Body() dto: SaveNotificationPreferenceDto) { return this.parents.savePreference(u.sub, dto); }
  @Get('children/:childId/media') photos(@CurrentUser() u: CurrentUserPayload, @Param() child: ChildIdParam, @Req() req: Request) { return this.parents.photos(u.sub, child.childId, req.ip); }
  @Get('children/:childId/health') health(@CurrentUser() u: CurrentUserPayload, @Param() child: ChildIdParam, @Req() req: Request) { return this.parents.childHealth(u.sub, child.childId, req.ip); }
  @Get('children/:childId/media/:mediaId/download') photo(@CurrentUser() u: CurrentUserPayload, @Param('childId') childId: string, @Param('mediaId') mediaId: string, @Req() req: Request) {
    return this.parents.photoUrl(u.sub, childId, mediaId, req.ip);
  }

  // ── Factures et reçus — lecture seule, permission can_receive_invoices ────

  @Get('invoices') invoices(@CurrentUser() u: CurrentUserPayload) { return this.parents.invoices(u.sub); }
  @Get('invoices/:invoiceId') invoice(@CurrentUser() u: CurrentUserPayload, @Param() p: InvoiceIdParam) { return this.parents.invoiceDetail(u.sub, p.invoiceId); }
  @Get('invoices/:invoiceId/pdf') async invoicePdf(@CurrentUser() u: CurrentUserPayload, @Param() p: InvoiceIdParam, @Req() req: Request, @Res() res: Response) {
    const result = await this.parents.invoicePdf(u.sub, p.invoiceId, req.ip);
    if (result.kind === 'redirect') return res.redirect(HttpStatus.FOUND, result.url);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${result.invoice.invoice_number ?? 'facture'}.pdf"`);
    res.send(result.buffer);
  }
  @Get('receipts') receipts(@CurrentUser() u: CurrentUserPayload) { return this.parents.receipts(u.sub); }
  @Get('receipts/:paymentId') receipt(@CurrentUser() u: CurrentUserPayload, @Param() p: PaymentIdParam) { return this.parents.receiptDetail(u.sub, p.paymentId); }
}
