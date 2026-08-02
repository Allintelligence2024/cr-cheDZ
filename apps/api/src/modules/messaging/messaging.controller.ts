import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ConversationIdParam, CreateConversationDto, SendMessageDto } from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

const STAFF_CREATE = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** Création d'une conversation (staff) — gardiens de l'enfant ajoutés automatiquement. */
  @Post('conversations')
  @Roles(...STAFF_CREATE)
  create(@Body() dto: CreateConversationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.messaging.createConversation(u.sub, dto);
  }

  /** Liste des conversations dont l'utilisateur est participant (staff + parents). */
  @Get('conversations')
  list(@CurrentUser() u: CurrentUserPayload) {
    return this.messaging.listConversations(u.sub);
  }

  @Get('conversations/:id')
  detail(@Param() p: ConversationIdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.messaging.getConversation(u.sub, p.id);
  }

  @Post('conversations/:id/messages')
  send(@Param() p: ConversationIdParam, @Body() dto: SendMessageDto, @CurrentUser() u: CurrentUserPayload) {
    return this.messaging.sendMessage(u.sub, p.id, dto);
  }

  @Post('conversations/:id/read')
  markRead(@Param() p: ConversationIdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.messaging.markRead(u.sub, p.id);
  }
}
