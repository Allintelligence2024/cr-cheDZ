import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from '../modules/metrics/metrics.service';

/**
 * Middleware de comptage HTTP pour /metrics (Phase 11).
 * Route pattern exprimé par Express (req.route.path) avec repli sur req.path.
 * Ne journalise AUCUNE donnée requête/réponse (pas de PII).
 */
export function metricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = (req as Request & { route?: { path?: string } }).route?.path ?? req.path;
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.httpRequest(req.method, route, res.statusCode, durationSeconds);
    });
    next();
  };
}
