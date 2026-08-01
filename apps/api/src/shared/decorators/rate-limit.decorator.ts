import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  points: number;
  windowMs: number;
}

/** Limite de fréquence par IP + route (fenêtre glissante en mémoire). */
export const RateLimit = (points: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { points, windowMs } satisfies RateLimitOptions);
