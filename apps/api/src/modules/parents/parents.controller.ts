import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sendStorageObject } from '../../shared/storage/object-stream';
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
    // LOT 2 (P0 F5) : renvoie un chemin same-origin, plus jamais une URL
    // signée MinIO inexploitable depuis un téléphone.
    return this.parents.photoUrl(u.sub, childId, mediaId, req.ip);
  }

  /**
   * Contenu de la photo — flux same-origin, re-contrôlé avant chaque octet
   * (filiation, visibilité, consentement photo courant) et journalisé.
   */
  @Get('children/:childId/media/:mediaId/content')
  async photoContent(@CurrentUser() u: CurrentUserPayload, @Param('childId') childId: string, @Param('mediaId') mediaId: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { object, mimeType, filename } = await this.parents.photoContent(u.sub, childId, mediaId, req.ip);
    sendStorageObject(res, req, object, {
      contentType: mimeType,
      filename: filename ?? undefined,
      inline: true,
      onStreamError: {
        code: 'MEDIA_CONTENT_MISSING',
        messageFr: 'Le fichier de la photo est introuvable sur le stockage',
        messageAr: 'ملف الصورة غير موجود في التخزين',
      },
    });
  }

  // ── Factures et reçus — lecture seule, permission can_receive_invoices ────

  @Get('invoices') invoices(@CurrentUser() u: CurrentUserPayload) { return this.parents.invoices(u.sub); }
  @Get('invoices/:invoiceId') invoice(@CurrentUser() u: CurrentUserPayload, @Param() p: InvoiceIdParam) { return this.parents.invoiceDetail(u.sub, p.invoiceId); }
  @Get('invoices/:invoiceId/pdf') async invoicePdf(@CurrentUser() u: CurrentUserPayload, @Param() p: InvoiceIdParam, @Req() req: Request, @Res() res: Response) {
    // LOT 2 (P0 F5) : flux same-origin, plus de redirection vers MinIO.
    const result = await this.parents.invoicePdf(u.sub, p.invoiceId, req.ip);
    sendStorageObject(res, req, result.object, {
      contentType: 'application/pdf',
      filename: `${result.invoice.invoice_number ?? 'facture'}.pdf`,
      inline: true,
      onStreamError: {
        code: 'PDF_NOT_READY',
        messageFr: 'Le PDF n’est pas encore généré',
        messageAr: 'لم يتم إنشاء ملف PDF بعد',
      },
    });
  }
  @Get('receipts') receipts(@CurrentUser() u: CurrentUserPayload) { return this.parents.receipts(u.sub); }
  @Get('receipts/:paymentId') receipt(@CurrentUser() u: CurrentUserPayload, @Param() p: PaymentIdParam) { return this.parents.receiptDetail(u.sub, p.paymentId); }
}
