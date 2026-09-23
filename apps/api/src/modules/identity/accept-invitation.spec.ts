/**
 * Régression e2e « invitation-flow » : l'activation d'un compte depuis le
 * navigateur échouait systématiquement.
 *
 * Deux défauts, tous deux couverts ici :
 *
 * 1. `AcceptInvitationDto` n'acceptait pas `web_client`, alors qu'admin-web
 *    l'envoie. Le ValidationPipe global est configuré avec
 *    `forbidNonWhitelisted: true` (app.factory.ts) : la requête partait donc
 *    en 400 « property web_client should not exist », le front restait sur
 *    /accept-invitation et le test e2e échouait sur `toHaveURL(/\/$/)`.
 *
 * 2. Même une fois le champ accepté, le contrôleur ne posait pas le cookie
 *    httpOnly du refresh token — alors que /auth/login le fait. Accepter une
 *    invitation ouvre pourtant bien une session : sans ce cookie, le premier
 *    rafraîchissement échoue et l'utilisateur est redéconnecté.
 */

import { ValidationPipe } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AcceptInvitationDto } from './dto/auth.dto';
import type { AuthService, LoginResult } from './auth.service';

const VALID_PAYLOAD = {
  invitation_token: 'a'.repeat(32),
  first_name: 'E2E',
  last_name: 'Invitée',
  password: 'password123',
};

/** Rejoue exactement la configuration du pipe global (app.factory.ts). */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const metadata = { type: 'body' as const, metatype: AcceptInvitationDto };

describe('AcceptInvitationDto — validation', () => {
  it('accepte web_client: true (envoyé par admin-web)', async () => {
    const dto = await pipe.transform({ ...VALID_PAYLOAD, web_client: true }, metadata);
    expect(dto.web_client).toBe(true);
  });

  it('reste valide sans web_client (clients mobiles)', async () => {
    const dto = await pipe.transform({ ...VALID_PAYLOAD }, metadata);
    expect(dto.web_client).toBeUndefined();
  });

  it('refuse toujours un champ réellement inconnu', async () => {
    await expect(pipe.transform({ ...VALID_PAYLOAD, nope: 1 }, metadata)).rejects.toThrow();
  });
});

describe('AuthController.acceptInvitation — cookie de session', () => {
  const result: LoginResult = {
    access_token: 'access',
    refresh_token: 'refresh',
  } as LoginResult;

  const makeController = (): { controller: AuthController; cookies: Array<[string, string]> } => {
    const cookies: Array<[string, string]> = [];
    const res = {
      cookie: (name: string, value: string) => {
        cookies.push([name, value]);
      },
    };
    const authService = { acceptInvitation: jest.fn().mockResolvedValue(result) };
    const controller = new AuthController(authService as unknown as AuthService);
    return {
      controller: Object.assign(controller, { __res: res }) as AuthController,
      cookies,
    };
  };

  const req = { ip: '127.0.0.1', headers: {} } as never;

  it('pose le cookie httpOnly quand web_client vaut true', async () => {
    const { controller, cookies } = makeController();
    const res = (controller as unknown as { __res: unknown }).__res;
    await controller.acceptInvitation(
      { ...VALID_PAYLOAD, web_client: true } as AcceptInvitationDto,
      req,
      res as never,
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0][1]).toBe('refresh');
  });

  it('ne pose aucun cookie pour un client mobile', async () => {
    const { controller, cookies } = makeController();
    const res = (controller as unknown as { __res: unknown }).__res;
    await controller.acceptInvitation({ ...VALID_PAYLOAD } as AcceptInvitationDto, req, res as never);
    expect(cookies).toHaveLength(0);
  });
});
