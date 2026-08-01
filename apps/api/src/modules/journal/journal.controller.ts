import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateJournalEventDto, GroupJournalEventDto, JournalListQuery } from './dto/journal.dto';
import { JournalService } from './journal.service';

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Post('events')
  @Roles(...STAFF_ROLES)
  async createEvent(
    @Body() dto: CreateJournalEventDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.journalService.createEvent(user.sub, dto);
  }

  /** Action groupée : repas/sieste/change/activité pour plusieurs enfants. */
  @Post('group-actions')
  @Roles(...STAFF_ROLES)
  async groupAction(
    @Body() dto: GroupJournalEventDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
    return this.journalService.groupAction(user.sub, dto);
  }

  @Get('events')
  @Roles(...STAFF_ROLES)
  async list(
    @Query() query: JournalListQuery,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.journalService.listForChild(query.child_id, query.date) };
  }

  /** Fil visible parents (prévisualisation personnel ; accès parent sécurisé Phase 7). */
  @Get('feed')
  @Roles(...STAFF_ROLES)
  async feed(
    @Query() query: JournalListQuery,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.journalService.feedForChild(query.child_id, query.date) };
  }
}
