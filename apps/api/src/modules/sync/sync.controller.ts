import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { SyncPullQuery, SyncPushDto, type SyncPushResult } from './dto/sync.dto';
import { SyncService } from './sync.service';

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @Roles(...STAFF_ROLES)
  async push(
    @Body() dto: SyncPushDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<SyncPushResult> {
    return this.syncService.push(dto.device_id, user.sub, dto.operations);
  }

  @Get('pull')
  @Roles(...STAFF_ROLES)
  async pull(
    @Query() query: SyncPullQuery,
  ): Promise<{ events: Array<Record<string, unknown>>; next_cursor: number }> {
    return this.syncService.pull(query.cursor, query.device_id);
  }
}
