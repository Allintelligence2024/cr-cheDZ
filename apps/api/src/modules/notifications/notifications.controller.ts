import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class NotificationIdParam {
  @IsUUID()
  id!: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('inbox')
  async inbox(@CurrentUser() user: CurrentUserPayload): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.notificationsService.inbox(user.sub) };
  }

  @Post('inbox/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param() params: NotificationIdParam,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.notificationsService.markRead(user.sub, params.id);
  }
}
