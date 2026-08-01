import { Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limiting en mémoire (fenêtre fixe par IP + clé).
 * Suffisant pour une instance unique ; remplacé par nginx en frontal
 * et Redis si plusieurs instances (Phase 11).
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, points: number, windowMs: number): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > points) {
      throw new Error('RATE_LIMITED');
    }
  }

  /** Nettoyage des buckets expirés (appelé périodiquement ou à la demande). */
  sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
