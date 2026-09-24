import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  livenessAgeMs,
  livenessFile,
  livenessIntervalMs,
  livenessMaxAgeMs,
  startLiveness,
  touchLiveness,
} from './liveness';

describe('liveness du worker (F2 — audit 2026-09-24)', () => {
  let dir: string;
  const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...overrides });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'creche-liveness-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('écrit puis rafraîchit le marqueur, et le supprime à l’arrêt', async () => {
    const file = join(dir, 'alive');
    const stop = await startLiveness(env({ WORKER_LIVENESS_FILE: file, WORKER_LIVENESS_INTERVAL_MS: '1000' }));
    expect(await livenessAgeMs(file)).toBeLessThan(livenessMaxAgeMs(env({ WORKER_LIVENESS_INTERVAL_MS: '1000' })));
    await stop();
    expect(await livenessAgeMs(file)).toBe(Number.POSITIVE_INFINITY);
  });

  it('un marqueur périmé est détecté (worker figé)', async () => {
    const file = join(dir, 'stale');
    await touchLiveness(file);
    const past = new Date(Date.now() - 120_000);
    await utimes(file, past, past);
    const age = await livenessAgeMs(file);
    expect(age).toBeGreaterThan(livenessMaxAgeMs(env()));
    expect(age).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  it('`touchLiveness` est atomique : le marqueur n’est jamais partiel', async () => {
    const file = join(dir, 'atomic');
    // Résidu d'un écrivain mort : il ne doit jamais être lu comme le marqueur.
    await writeFile(`${file}.tmp`, 'reste-d-un-ecrivain-mort');
    await touchLiveness(file);
    expect(readFileSync(file, 'utf8')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readFileSync(file, 'utf8')).not.toContain('reste-d-un-ecrivain-mort');
    // le temporaire est consommé par le rename (rien de périmé ne subsiste)
    expect(await livenessAgeMs(`${file}.tmp`)).toBe(Number.POSITIVE_INFINITY);
  });

  it('bornes de configuration : jamais de boucle serrée ni d’âge nul', () => {
    expect(livenessIntervalMs(env({ WORKER_LIVENESS_INTERVAL_MS: '5' }))).toBe(10_000);
    expect(livenessIntervalMs(env({ WORKER_LIVENESS_INTERVAL_MS: 'abc' }))).toBe(10_000);
    expect(livenessMaxAgeMs(env({ WORKER_LIVENESS_MAX_AGE_MS: '0' }))).toBe(30_000);
    // par défaut l'âge maximal vaut 3 intervalles : 3 écritures manquées = mort
    expect(livenessMaxAgeMs(env({ WORKER_LIVENESS_INTERVAL_MS: '4000' }))).toBe(12_000);
    expect(livenessFile(env({ WORKER_LIVENESS_FILE: '/tmp/x' }))).toBe('/tmp/x');
  });

  it('câblage réel dans `main.ts` : démarré après les gardes de boot, arrêté sur SIGTERM', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    expect(main).toContain("import { startLiveness } from './liveness'");
    expect(main).toContain('const stopLiveness = await startLiveness()');
    expect(main).toContain("process.once(signal, () => void stopLiveness())");
    // un conteneur mal configuré ne doit pas paraître sain : la garde de rôle
    // précède l'écriture du marqueur
    expect(main.indexOf('assertApplicationDatabaseRole(pool)')).toBeLessThan(
      main.indexOf('await startLiveness()'),
    );
  });
});
