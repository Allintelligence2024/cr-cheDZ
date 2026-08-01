import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { ChildIdParam, MediaIdParam, ReportAbsenceDto, SaveConsentDto, SaveNotificationPreferenceDto } from './dto/parent.dto';
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
  @Get('children/:childId/media/:mediaId/download') photo(@CurrentUser() u: CurrentUserPayload, @Param() child: ChildIdParam, @Param() media: MediaIdParam, @Req() req: Request) {
    return this.parents.photoUrl(u.sub, child.childId, media.mediaId, req.ip);
  }
}
