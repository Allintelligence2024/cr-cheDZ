import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateInvitationDto } from './dto/invitations.dto';
import { InvitationsService, type InvitationResult } from './invitations.service';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles('super_admin', 'director')
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<InvitationResult> {
    return this.invitationsService.create(dto, user.sub);
  }

  @Get()
  @Roles('super_admin', 'director')
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.invitationsService.list() };
  }
}
