import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Marqueur de vivacité du worker (F2 de l'audit du 2026-09-24).
 *
 * Le worker n'expose aucun port : jusqu'ici, Docker n'avait donc AUCUN moyen de
 * savoir s'il était vivant, et un processus figé (boucle bloquée, pool saturé)
 * n'était jamais redémarré. Le worker écrit ici un fichier d'horodatage à
 * intervalle régulier ; `apps/worker/src/healthcheck.ts` (exécuté par
 * `HEALTHCHECK` Docker, dans le même conteneur) refuse un marqueur périmé.
 *
 * Pourquoi un fichier et pas la base : le heartbeat en base
 * (`jobs_heartbeat`, migration 053) n'existe QUE pendant le traitement d'un
 * job — un worker sain et au repos paraîtrait mort. Le marqueur est
 * volontairement local au conteneur : c'est une vivacité de PROCESSUS.
 */

/** Chemin du marqueur (surchargeable : le compose le fixe explicitement). */
export function livenessFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKER_LIVENESS_FILE ?? '/tmp/creche-worker-alive';
}

/** Intervalle d'écriture, borné à ≥ 1 s (jamais de boucle serrée). */
export function livenessIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.WORKER_LIVENESS_INTERVAL_MS ?? 10_000);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : 10_000;
}

/** Âge maximal accepté par la sonde ; par défaut 3 × l'intervalle d'écriture. */
export function livenessMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.WORKER_LIVENESS_MAX_AGE_MS ?? livenessIntervalMs(env) * 3);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/** Écriture atomique : `rename` remplace le marqueur, jamais de lecture partielle. */
export async function touchLiveness(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${new Date().toISOString()}\n`);
  await rename(temporary, file);
}

/** Âge du marqueur en millisecondes (`Infinity` s'il n'existe pas). */
export async function livenessAgeMs(file: string): Promise<number> {
  try {
    const info = await stat(file);
    return Date.now() - info.mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Démarre l'écriture périodique et rend la fonction d'arrêt (qui supprime le
 * marqueur — un worker arrêté proprement ne doit pas paraître vivant).
 */
export async function startLiveness(
  env: NodeJS.ProcessEnv = process.env,
  /**
   * 3.8.3 (remédiation 2026-10-04) — preuve de vie base de données. Sans
   * elle, le marqueur restait frais même avec un pool DB mort (connexion
   * perdue, credentials tournés) : le worker « vivant » ne traitait plus
   * aucun job et Docker ne le redémarrait jamais. La sonde doit être
   * `SELECT 1` sur le pool — pas une simple écriture fichier.
   */
  probe: () => Promise<boolean> = async () => true,
): Promise<() => Promise<void>> {
  const file = livenessFile(env);
  const intervalMs = livenessIntervalMs(env);
  let dbOk = true;
  await touchLiveness(file);
  const timer = setInterval(() => {
    // Le marqueur n'est rafraîchi QUE si la sonde base réussit. Une erreur
    // d'écriture disque ne doit jamais tuer le worker ; un pool DB mort, lui,
    // doit laisser le marqueur périmer → Docker redémarre le conteneur.
    void probe()
      .then(async (ok) => {
        dbOk = ok;
        if (ok) await touchLiveness(file);
        else console.error('[worker] liveness : sonde base de données ÉCHOUÉE — marqueur NON rafraîchi');
      })
      .catch((error) => {
        if (dbOk) console.error('[worker] liveness : sonde base de données en erreur :', error instanceof Error ? error.message : String(error));
        dbOk = false;
      });
  }, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await rm(file, { force: true }).catch(() => undefined);
  };
}
