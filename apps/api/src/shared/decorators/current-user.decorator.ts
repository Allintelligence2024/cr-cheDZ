import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Payload JWT de l'utilisateur courant (défini par JwtAuthGuard). */
export interface CurrentUserPayload {
  sub: string;
  organizationId: string | null;
  role: string;
  isSuperAdmin: boolean;
  email: string;
  /** G4 (audit 2026-09) : users.token_epoch au moment de la signature ;
   * absent (instance émettrice antérieure à la 062) = époque 0. */
  epoch?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);
