import { createServer, type RequestListener, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkApiHealth } from './healthcheck';

/**
 * Preuve de la sonde API livrée avec F2 (audit 2026-09-24) : la fonction que
 * l'entrée CLI `apps/api/dist/healthcheck.js` appelle est exercée **en cours de
 * processus** contre de vrais serveurs HTTP — pas de `dist/`, donc pas de
 * dépendance à un build préalable (le job CI `quality` ne construit pas l'API ;
 * une première version lançait l'artefact compilé et rougissait la CI).
 *
 * L'exécution du script COMPILÉ (ce que `docker inspect` exécute) est prouvée
 * hors CI, dans le journal du lot : rc=0 contre une API réelle, rc=1 sur port mort.
 */
async function listen(handler: RequestListener): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

describe('sonde API (F2 — audit 2026-09-24)', () => {
  it('considère l’API saine quand `/api/v1/health` répond `ok`', async () => {
    const { server, port } = await listen((req, res) => {
      // La sonde doit interroger le VRAI chemin public, pas un chemin inventé.
      expect(req.url).toBe('/api/v1/health');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0', time: new Date().toISOString() }));
    });
    try {
      const result = await checkApiHealth({ port, timeoutMs: 2000 });
      expect(result).toEqual({ ok: true, url: `http://127.0.0.1:${port}/api/v1/health` });
    } finally {
      await close(server);
    }
  });

  it.each([
    ['HTTP 500', 500, JSON.stringify({ status: 'ok' })],
    ['corps inattendu', 200, JSON.stringify({ status: 'degraded' })],
    ['corps non-JSON', 200, 'gateway error'],
  ])('considère l’API malsaine quand la réponse est %s', async (label, status, body) => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(status as number, { 'content-type': 'application/json' });
      res.end(body as string);
    });
    try {
      const result = await checkApiHealth({ port, timeoutMs: 2000 });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain(label === 'HTTP 500' ? 'HTTP 500' : 'corps inattendu');
    } finally {
      await close(server);
    }
  });

  it('considère l’API malsaine quand rien n’écoute (API morte)', async () => {
    const { server, port } = await listen((_req, res) => res.end());
    await close(server); // port libéré : personne n'écoute plus
    const result = await checkApiHealth({ port, timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('API indisponible');
  });

  it('considère l’API malsaine quand le serveur accepte mais ne répond jamais (API figée)', async () => {
    const { server, port } = await listen(() => {
      /* connexion acceptée, aucune réponse : simule une boucle figée */
    });
    try {
      const result = await checkApiHealth({ port, timeoutMs: 300 });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain('API indisponible');
    } finally {
      await close(server);
    }
  }, 15_000);

  it('câblage de l’entrée CLI : variables d’environnement, code de sortie, garde `require.main`', () => {
    const source = readFileSync(join(__dirname, 'healthcheck.ts'), 'utf8');
    // Docker appelle `node apps/api/dist/healthcheck.js` : l'entrée doit lire
    // APP_HOST/APP_PORT (le compose fixe APP_PORT explicitement) et sortir 1 en échec.
    expect(source).toContain('process.env.APP_HOST');
    expect(source).toContain('process.env.APP_PORT');
    expect(source).toContain('process.exit(1)');
    expect(source).toContain('process.exit(0)');
    // Sans cette garde, importer la sonde depuis les tests exécuterait le CLI.
    expect(source).toContain('require.main === module');
  });
});
