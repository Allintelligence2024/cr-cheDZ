import { RateLimitService } from './rate-limit.service';

/**
 * R13 (remédiation 2026-09-21, F11) — la Map buckets ne doit pas croître
 * sans borne. Vérifie que :
 *  1. check() crée un bucket puis l'incrémente ;
 *  2. sweep() retire les buckets expirés ;
 *  3. onModuleInit arme le timer en prod/dev, jamais en test ;
 *  4. onModuleDestroy libère le timer (pas de fuite lors d'un restart).
 */
describe('RateLimitService (R13)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('check() incrémente et déclenche RATE_LIMITED au-delà de points', () => {
    const svc = new RateLimitService();
    // 1ère, 2e, 3e : OK (compteur passe 1, 2, 3 ; seuil = 3 → 3 ≤ 3 = OK).
    expect(() => svc.check('ip:1.2.3.4', 3, 60_000)).not.toThrow();
    expect(() => svc.check('ip:1.2.3.4', 3, 60_000)).not.toThrow();
    expect(() => svc.check('ip:1.2.3.4', 3, 60_000)).not.toThrow();
    // 4e : compteur = 4 > 3 → throw.
    expect(() => svc.check('ip:1.2.3.4', 3, 60_000)).toThrow('RATE_LIMITED');
  });

  it('sweep() retire les buckets expirés (mémoire bornée)', async () => {
    const svc = new RateLimitService();
    svc.check('ip:a', 100, 5);     // expire dans 5 ms
    svc.check('ip:b', 100, 60_000); // expire dans 60 s
    expect(svc.__bucketCountForTest()).toBe(2);
    await new Promise((r) => setTimeout(r, 10));
    svc.sweep();
    expect(svc.__bucketCountForTest()).toBe(1);
  });

  it('onModuleInit : timer armé en dev/prod, JAMAIS en test', () => {
    // Mode test : pas de timer.
    process.env.NODE_ENV = 'test';
    let svc = new RateLimitService();
    svc.onModuleInit();
    expect((svc as unknown as { sweepTimer: NodeJS.Timeout | null }).sweepTimer).toBeNull();

    // Mode dev/prod : timer armé, .unref() appelé (timer.unref !== undefined).
    process.env.NODE_ENV = 'production';
    svc = new RateLimitService();
    svc.onModuleInit();
    const timer = (svc as unknown as { sweepTimer: NodeJS.Timeout | null }).sweepTimer;
    expect(timer).not.toBeNull();
    svc.onModuleDestroy();
    expect((svc as unknown as { sweepTimer: NodeJS.Timeout | null }).sweepTimer).toBeNull();
  });

  it('RATE_LIMIT_DISABLED=true désactive aussi le timer (drainage test/debug)', () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_DISABLED = 'true';
    const svc = new RateLimitService();
    svc.onModuleInit();
    expect((svc as unknown as { sweepTimer: NodeJS.Timeout | null }).sweepTimer).toBeNull();
  });
});
