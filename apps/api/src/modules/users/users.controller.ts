import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Errors } from '../../shared/errors';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { UsersService } from './users.service';

class AssignmentIdParam {
  @IsUUID() id!: string;
}

/** Corps validé : `role_id` doit être un UUID (sans DTO, la valeur brute
 *  atteignait la requête et faisait échouer le cast uuid en 500). */
class AddRoleDto {
  @IsUUID() role_id!: string;
}

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Profil + organisations + rôle + permissions. */
  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.usersService.me(user.sub);
  }

  // ── Multi-rôles (roadmap v2, migration 040) ───────────────────────────────

  /** Rôles additionnels d'un membre de l'organisation (directeur). */
  @Get('members/:userId/roles')
  @Roles('director', 'super_admin')
  memberRoles(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() u: CurrentUserPayload): Promise<Array<Record<string, unknown>>> {
    if (!u.organizationId) throw Errors.forbidden();
    return this.usersService.listRoleAssignments(userId, u.organizationId);
  }

  /** Assigne un rôle additionnel (directeur). */
  @Post('members/:userId/roles')
  @Roles('director', 'super_admin')
  addRole(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AddRoleDto, @CurrentUser() u: CurrentUserPayload): Promise<Record<string, unknown>> {
    if (!u.organizationId) throw Errors.forbidden();
    return this.usersService.addRoleAssignment(u.sub, u.organizationId, { user_id: userId, role_id: dto.role_id });
  }

  /** Retire un rôle additionnel (directeur). */
  @Delete('role-assignments/:id')
  @Roles('director', 'super_admin')
  async removeRole(@Param() p: AssignmentIdParam, @CurrentUser() u: CurrentUserPayload): Promise<void> {
    if (!u.organizationId) throw Errors.forbidden();
    await this.usersService.removeRoleAssignment(u.organizationId, p.id, u.sub);
  }
}
