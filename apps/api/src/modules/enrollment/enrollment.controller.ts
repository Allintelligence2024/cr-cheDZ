import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateEnrollmentRequestDto, DecideDto, EnrollmentListQuery, OfferPlaceDto } from './dto/enrollment.dto';
import { EnrollmentService } from './enrollment.service';

/** P2-4 : pré-inscriptions & liste d'attente — direction et réception.
 *  R5 (remédiation 2026-09-21) : la réception saisit et lit les demandes ;
 *  les décisions de capacité (waitlist/offer/decide) sont director-only —
 *  la méthode gagne sur la classe (RolesGuard : handler ?? class). */
@Controller('enrollment')
@Roles('director', 'receptionist')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Post('requests')
  create(@CurrentUser() u: CurrentUserPayload, @Body() dto: CreateEnrollmentRequestDto) {
    return this.enrollment.create(u.sub, dto);
  }

  @Get('requests')
  list(@Query() q: EnrollmentListQuery) {
    return this.enrollment.list(q);
  }

  @Get('capacity/:siteId')
  capacity(@Param('siteId', new ParseUUIDPipe()) siteId: string) {
    return this.enrollment.capacity(siteId);
  }

  @Post('requests/:id/waitlist')
  @Roles('director')
  waitlist(@CurrentUser() u: CurrentUserPayload, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.enrollment.waitlist(u.sub, id);
  }

  @Post('requests/:id/offer')
  @Roles('director')
  offer(@CurrentUser() u: CurrentUserPayload, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: OfferPlaceDto) {
    return this.enrollment.offer(u.sub, id, dto);
  }

  @Post('requests/:id/decide')
  @Roles('director')
  decide(@CurrentUser() u: CurrentUserPayload, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideDto) {
    return this.enrollment.decide(u.sub, id, dto);
  }
}
