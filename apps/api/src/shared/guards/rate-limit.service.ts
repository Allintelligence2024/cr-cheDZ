import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limiting en mémoire (fenêtre fixe par IP + clé).
 * Suffisant pour une instance unique ; remplacé par nginx en frontal
 * et Redis si plusieurs instances (Phase 11).
 *
 * R13 (remédiation 2026-09-21, F11) : la Map buckets grossissait sans borne
 * (n'importe quelle clé jamais répétée — IP éphémère d'un bot, d'un scanner,
 * d'un NAT partagé — laissait un bucket expiré mais jamais collecté). Ici,
 * un `setInterval(sweep, intervalMs)` est armé à l'init du module et coupé
 * proprement au destroy (signal SIGTERM du worker lors d'un rolling restart).
 * L'intervalle est généreux (60 s) : le but n'est pas la latence, c'est
 * borner la mémoire en O(actifs). Pas de timer en test : `NODE_ENV=test` →
 * interval = 0 (jamais armé). Pas de fuite `unref()` côté test.
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(RateLimitService.name);

  /** Intervalle de sweep : 60 s en prod/dev, jamais en test. */
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === 'true') {
      return;
    }
    this.sweepTimer = setInterval(() => this.sweep(), RateLimitService.SWEEP_INTERVAL_MS);
    // `unref()` côté prod pour ne PAS garder la boucle d'événements vivante
    // quand l'API est arrêtée par SIGTERM (cf. R12 — worker également).
    this.sweepTimer.unref?.();
    this.logger.log(`Rate-limit auto-sweep armé (${RateLimitService.SWEEP_INTERVAL_MS} ms)`);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
      this.logger.log('Rate-limit auto-sweep coupé (onModuleDestroy)');
    }
  }

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

  /** Nettoyage des buckets expirés — appelé par le timer OU à la demande. */
  sweep(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    if (removed > 0 && process.env.NODE_ENV !== 'test') {
      this.logger.debug(`Rate-limit sweep : ${removed} bucket(s) expiré(s) retiré(s) ; ${this.buckets.size} actifs`);
    }
  }

  /** Test-only : exposer la taille actuelle pour les assertions de mémoire bornée. */
  __bucketCountForTest(): number {
    return this.buckets.size;
  }
}
