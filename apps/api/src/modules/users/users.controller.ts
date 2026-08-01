import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Profil + organisations + rôle + permissions. */
  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.usersService.me(user.sub);
  }
}
