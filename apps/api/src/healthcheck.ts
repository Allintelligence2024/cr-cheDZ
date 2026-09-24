/**
 * Sonde de vivacité de l'API — exécutée DANS le conteneur par Docker
 * (`HEALTHCHECK`) et disponible à la main pour un diagnostic :
 *
 *   docker compose -f infrastructure/docker/docker-compose.prod.yml exec api \
 *     node apps/api/dist/healthcheck.js
 *
 * Pourquoi ce fichier et pas une commande `curl` : l'image d'exécution est
 * `node:22-slim` (aucun `curl`/`wget`). Node 22 fournit `fetch` — la sonde ne
 * dépend donc que du runtime déjà présent, et interroge le VRAI chemin public
 * (`GET /api/v1/health`, `@Public()`) servi par le même processus.
 *
 * Avant ce lot (F2 de l'audit du 2026-09-24), Docker n'interrogeait RIEN pour
 * l'API et le worker : un processus vivant mais bloqué (pool saturé, boucle
 * figée) n'était jamais redémarré, et l'endpoint `/api/v1/health` n'était sondé
 * que par nginx et la CI.
 *
 * Structure : la logique vit dans `checkApiHealth()` (testable **en cours de
 * processus**, sans artefact de build — `apps/api/src/healthcheck.spec.ts`
 * l'exerce contre de vrais serveurs HTTP) ; le bas de fichier n'est qu'une
 * entrée CLI (message + code de sortie) invoquée par Docker.
 *
 * Contrat de sortie : 0 = sain, 1 = mauvais (message explicite sur stderr).
 * Variables : APP_HOST (défaut 127.0.0.1), APP_PORT (défaut 3000),
 * HEALTHCHECK_TIMEOUT_MS (défaut 3000).
 */

export interface ApiHealthCheckOptions {
  host?: string;
  port?: string | number;
  timeoutMs?: number;
}

export type ApiHealthCheckResult = { ok: true; url: string } | { ok: false; url: string; reason: string };

/**
 * Interroge `GET <host>:<port>/api/v1/health` et rend un verdict explicite.
 * Ne lève jamais : l'appelant (entrée CLI) décide du code de sortie.
 */
export async function checkApiHealth(options: ApiHealthCheckOptions = {}): Promise<ApiHealthCheckResult> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? '3000';
  const url = `http://${host}:${port}/api/v1/health`;
  const timeoutMs = options.timeoutMs ?? 3000;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { ok: false, url, reason: `API indisponible : ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) return { ok: false, url, reason: `API non saine : HTTP ${response.status}` };
  const body = (await response.json().catch(() => null)) as { status?: string } | null;
  if (body?.status !== 'ok') return { ok: false, url, reason: `API non saine : corps inattendu ${JSON.stringify(body)}` };
  return { ok: true, url };
}

async function main(): Promise<void> {
  const result = await checkApiHealth({
    host: process.env.APP_HOST,
    port: process.env.APP_PORT,
    timeoutMs: Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 3000),
  });
  if (!result.ok) {
    console.error(`${result.reason} (${result.url})`);
    process.exit(1);
  }
  // Le détail n'est écrit que sur stdout : `docker inspect` le montre, jamais
  // le client HTTP (aucune fuite d'information par la sonde).
  console.log(`API saine (${result.url}) : ${new Date().toISOString()}`);
  process.exit(0);
}

// `require.main === module` : importer ce fichier (tests) n'exécute pas la sonde.
if (require.main === module) void main();
