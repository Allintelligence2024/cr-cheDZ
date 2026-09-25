import { HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppError } from '../errors';

/**
 * Filtre global d'exceptions — contrat de sortie HTTP.
 *
 * Cas verrouillés ici (aucune base requise) :
 *  - `AppError`      → statut + code + messages FR/AR de l'erreur métier ;
 *  - `HttpException` → code dérivé du statut, ou **code métier** passé en
 *    message (`BadRequestException('CODE_METIER')`) ;
 *  - **corps trop volumineux** — erreur du body-parser d'express
 *    (`{ status: 413, type: 'entity.too.large' }`), qui n'est PAS une
 *    `HttpException` : elle doit rendre **413 PAYLOAD_TOO_LARGE** avec un
 *    message bilingue, jamais 500 « erreur interne » (mesuré en phase77 : un
 *    envoi de ~300 Ko dans `POST /sync/push` rendait 500 avant ce correctif —
 *    le client croyait à une panne et réessayait au lieu de réduire son envoi) ;
 *  - erreur inconnue → 500 INTERNAL_ERROR, journalisée (jamais de fuite de
 *    détail interne dans le corps).
 */
describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  let captured: { status: number; body: Record<string, unknown> };

  const host = (): ArgumentsHost => ({
    switchToHttp: () => ({
      getResponse: () => ({
        status: (status: number) => ({
          json: (body: Record<string, unknown>) => { captured = { status, body }; },
        }),
      }),
      getRequest: () => ({ correlationId: 'test-correlation', method: 'POST', url: '/api/v1/sync/push' }),
    }),
  }) as unknown as ArgumentsHost;

  beforeEach(() => { captured = { status: 0, body: {} }; });

  it('AppError → statut, code et messages bilingues de l’erreur métier', () => {
    filter.catch(new AppError('MEDIA_NOT_FOUND', 'Média introuvable', 'الوسائط غير موجودة', 404), host());
    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({
      statusCode: 404, code: 'MEDIA_NOT_FOUND', message_fr: 'Média introuvable', message_ar: 'الوسائط غير موجودة',
    });
  });

  it('HttpException : un code métier en message prime sur le code du statut', () => {
    filter.catch(new HttpException('EVENT_ID_REUSED', 400), host());
    expect(captured.status).toBe(400);
    expect(captured.body.code).toBe('EVENT_ID_REUSED');
  });

  it('corps trop volumineux (body-parser, status 413) → 413 PAYLOAD_TOO_LARGE, jamais 500', () => {
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch({ status: 413, type: 'entity.too.large', message: 'request entity too large' }, host());
    expect(captured.status).toBe(413);
    expect(captured.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(String(captured.body.message_fr)).toMatch(/volumineux/i);
    expect(String(captured.body.message_ar).length).toBeGreaterThan(0);
    expect(captured.body.message_fr).not.toMatch(/interne/i);
    // Un refus de client n'est pas une panne serveur : pas de log d'erreur.
    expect(loggerError).not.toHaveBeenCalled();
    loggerError.mockRestore();
  });

  it('erreur inconnue → 500 INTERNAL_ERROR journalisée, sans détail interne exposé', () => {
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('secret interne: connexion pg://user:motdepasse@hôte'), host());
    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(captured.body)).not.toContain('motdepasse');
    expect(loggerError).toHaveBeenCalled();
    loggerError.mockRestore();
  });
});
