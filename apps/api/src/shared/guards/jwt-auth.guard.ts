import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Errors } from '../errors';
import { TenantContextService } from '../database/tenant-context.service';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

/**
 * JwtAuthGuard — authentification JWT (access token 15 min).
 * Injecte le contexte tenant (organization_id + user_id) dans le
 * TenantContextService pour la durée de la requête (Partie 3.3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) ??
      Reflect.getMetadata(IS_PUBLIC_KEY, context.getClass());
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request.headers.authorization);
    if (!token) throw Errors.unauthorized();

    try {
      const payload = await this.jwtService.verifyAsync<CurrentUserPayload>(token);
      request.user = payload;
      if (payload.organizationId) {
        this.tenantContext.setContext(payload.organizationId, payload.sub);
      }
      return true;
    } catch {
      throw Errors.unauthorized();
    }
  }

  private extractBearer(header?: string): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }
}
