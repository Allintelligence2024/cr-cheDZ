/**
 * Sonde de vivacité du worker — exécutée DANS le conteneur par Docker
 * (`HEALTHCHECK`), et disponible à la main :
 *
 *   docker compose -f infrastructure/docker/docker-compose.prod.yml exec worker \
 *     node apps/worker/dist/healthcheck.js
 *
 * Le worker n'expose aucun port : la preuve de vie est le marqueur écrit par
 * `startLiveness()` (voir `liveness.ts`). Un marqueur absent ou périmé signifie
 * « processus figé ou mort » → sortie 1, Docker redémarre le conteneur (le bail
 * de job est reprit par `jobs_reap_stale`, migration 053 : aucun job n'est perdu).
 *
 * Contrat de sortie : 0 = sain, 1 = mauvais (message explicite sur stderr).
 * Variables : WORKER_LIVENESS_FILE, WORKER_LIVENESS_MAX_AGE_MS.
 */
import { livenessAgeMs, livenessFile, livenessMaxAgeMs } from './liveness';

async function main(): Promise<void> {
  const file = livenessFile();
  const maxAge = livenessMaxAgeMs();
  const age = await livenessAgeMs(file);
  if (age === Number.POSITIVE_INFINITY) {
    console.error(`Worker non vivant : marqueur absent (${file})`);
    process.exit(1);
  }
  if (age > maxAge) {
    console.error(
      `Worker non vivant : marqueur périmé de ${Math.round(age / 1000)} s (maximum ${Math.round(maxAge / 1000)} s, ${file})`,
    );
    process.exit(1);
  }
  console.log(`Worker vivant (marqueur vieux de ${Math.round(age / 1000)} s)`);
  process.exit(0);
}

void main();
