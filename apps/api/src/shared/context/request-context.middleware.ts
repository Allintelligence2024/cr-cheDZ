import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

/**
 * Middleware racine :
 *  1. Correlation ID (header client ou généré) sur req + réponse.
 *  2. Contexte AsyncLocalStorage pour la requête (tenant rempli par le guard).
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  requestContextStorage.run(
    { tenantId: null, userId: null, correlationId },
    () => next(),
  );
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: {
        sub: string;
        organizationId: string | null;
        role: string;
        isSuperAdmin: boolean;
        email: string;
      };
    }
  }
}
