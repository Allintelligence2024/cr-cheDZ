import { spawn } from 'node:child_process';
import { createServer, type RequestListener, type Server } from 'node:http';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';

/**
 * Preuve de la sonde API livrée avec F2 (audit 2026-09-24) : `apps/api/src/healthcheck.ts`
 * est exécuté DANS le conteneur par le HEALTHCHECK Docker. Les tests lancent le
 * script compilé (`dist/healthcheck.js`) — c'est-à-dire exactement ce que
 * `docker inspect` exécute — contre un vrai serveur HTTP, sain puis défaillant.
 */
// dist/ est construit par `npm run build --workspace @creche/api` — étape
// « Build api + worker » du job `quality`, avant les tests unitaires.
const script = join(__dirname, '..', 'dist', 'healthcheck.js');
if (!existsSync(script)) {
  throw new Error(
    `${script} absent : exécuter \`npm run build --workspace @creche/api\` avant les tests unitaires`,
  );
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProbe(port: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, APP_HOST: '127.0.0.1', APP_PORT: String(port), HEALTHCHECK_TIMEOUT_MS: '2000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(handler: RequestListener): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

describe('sonde API (F2 — audit 2026-09-24)', () => {
  it('sort 0 et journalise quand `/api/v1/health` répond `ok`', async () => {
    const { server, port } = await listen((req, res) => {
      // La sonde doit interroger le VRAI chemin public, pas un chemin inventé.
      expect(req.url).toBe('/api/v1/health');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0', time: new Date().toISOString() }));
    });
    try {
      const result = await runProbe(port);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('API saine');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ['HTTP 500', 500, JSON.stringify({ status: 'ok' })],
    ['corps inattendu', 200, JSON.stringify({ status: 'degraded' })],
    ['corps non-JSON', 200, 'gateway error'],
  ])('sort 1 quand la réponse est %s', async (_label, status, body) => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(status as number, { 'content-type': 'application/json' });
      res.end(body as string);
    });
    try {
      const result = await runProbe(port);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('API non saine');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('sort 1 quand rien n’écoute (API morte) avec un motif explicite', async () => {
    // Port libre puis fermé : personne n'écoute.
    const { server, port } = await listen((_req, res) => res.end());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await runProbe(port);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('API indisponible');
  });

  it('sort 1 sur serveur qui accepte mais ne répond jamais (API figée)', async () => {
    const { server, port } = await listen(() => {
      /* connexion acceptée, aucune réponse : simule une boucle figée */
    });
    try {
      const result = await runProbe(port);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('API indisponible');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});
