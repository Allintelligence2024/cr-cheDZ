import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../decorators/rate-limit.decorator';
import { Errors } from '../errors';
import { RateLimitService } from './rate-limit.service';

/** Applique la limite @RateLimit(...) si le décorateur est présent. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    // Désactivation pour les tests d'intégration et les load tests
    // (RATE_LIMIT_DISABLED=true). En production, le rate limiting est aussi
    // enforce au niveau nginx (auth 5 r/m, api 30 r/m, sync 60 r/m).
    if (process.env.RATE_LIMIT_DISABLED === 'true') return true;

    const options =
      Reflect.getMetadata(RATE_LIMIT_KEY, context.getHandler()) ??
      Reflect.getMetadata(RATE_LIMIT_KEY, context.getClass());
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const { points, windowMs } = options as RateLimitOptions;
    const ip = request.ip ?? 'unknown';
    const key = `${ip}:${request.route?.path ?? request.path}`;

    try {
      this.rateLimit.check(key, points, windowMs);
      return true;
    } catch {
      throw Errors.rateLimited();
    }
  }
}
