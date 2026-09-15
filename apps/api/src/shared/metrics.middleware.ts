import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from '../modules/metrics/metrics.service';

/**
 * Middleware de comptage HTTP pour /metrics (Phase 11).
 * Route pattern Express uniquement ; route inconnue regroupée sans conserver son URL.
 * Ne journalise AUCUNE donnée requête/réponse (pas de PII).
 */
export function metricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = (req as Request & { route?: { path?: string } }).route?.path ?? 'unmatched';
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
      metrics.httpRequest(method, route, res.statusCode, durationSeconds);
    });
    next();
  };
}
