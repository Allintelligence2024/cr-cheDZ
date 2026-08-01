import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Payload JWT de l'utilisateur courant (défini par JwtAuthGuard). */
export interface CurrentUserPayload {
  sub: string;
  organizationId: string | null;
  role: string;
  isSuperAdmin: boolean;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);
