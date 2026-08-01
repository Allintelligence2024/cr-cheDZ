import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Errors } from '../errors';

/** Vérifie @Roles('director', …) contre le rôle embarqué dans le JWT.
 *  Les métadonnées sont lues au niveau du handler PUIS de la classe
 *  (@Roles sur un contrôleur s'applique à toutes ses routes). */
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const roles =
      (Reflect.getMetadata(ROLES_KEY, context.getHandler()) as string[] | undefined) ??
      (Reflect.getMetadata(ROLES_KEY, context.getClass()) as string[] | undefined);
    if (!roles || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      throw Errors.forbidden();
    }
    return true;
  }
}
