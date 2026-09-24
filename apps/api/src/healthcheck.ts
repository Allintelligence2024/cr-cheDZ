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
 * Contrat de sortie : 0 = sain, 1 = mauvais (message explicite sur stderr).
 * Variables : APP_HOST (défaut 127.0.0.1), APP_PORT (défaut 3000),
 * HEALTHCHECK_TIMEOUT_MS (défaut 3000).
 */

const host = process.env.APP_HOST ?? '127.0.0.1';
const port = process.env.APP_PORT ?? '3000';
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 3000);
const url = `http://${host}:${port}/api/v1/health`;

async function main(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    console.error(`API indisponible (${url}) : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`API non saine (${url}) : HTTP ${response.status}`);
    process.exit(1);
  }
  const body = (await response.json().catch(() => null)) as { status?: string } | null;
  if (body?.status !== 'ok') {
    console.error(`API non saine (${url}) : corps inattendu ${JSON.stringify(body)}`);
    process.exit(1);
  }
  // Le détail n'est écrit que sur stdout : `docker inspect` le montre, jamais
  // le client HTTP (aucune fuite d'information par la sonde).
  console.log(`API saine (${url}) : ${new Date().toISOString()}`);
  process.exit(0);
}

void main();
