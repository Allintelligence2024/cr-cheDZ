import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

export interface ClaimedJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  organization_id: string | null;
  attempts: number;
  max_attempts: number;
  lease_token: string;
}
export type JobHandlers = Record<string, (payload: unknown, orgId: string | null, job: ClaimedJob) => Promise<void>>;

export function workerConfig(env: NodeJS.ProcessEnv = process.env) {
  const ms = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`WORKER_CONFIG_INVALID: ${name} doit être un entier positif en millisecondes`);
    }
    return value;
  };
  const config = {
    pollMs: ms('WORKER_POLL_MS', 2000),
    reaperMs: ms('WORKER_REAPER_INTERVAL_MS', 300_000),
    timeoutMs: ms('WORKER_JOB_TIMEOUT_MS', 900_000),
    heartbeatMs: ms('WORKER_HEARTBEAT_MS', 30_000),
    shutdownMs: ms('WORKER_SHUTDOWN_TIMEOUT_MS', 45_000),
    schedulePollMs: ms('WORKER_SCHEDULER_POLL_MS', 60_000),
    exportTimeoutMs: ms('WORKER_EXPORT_TIMEOUT_MS', 120_000),
    exportMaxAgeMs: ms('WORKER_EXPORT_MAX_AGE_MS', 1_800_000),
    schedulerEnabled: (env.WORKER_SCHEDULER_ENABLED ?? 'true') === 'true',
  };
  if (!['true','false'].includes(env.WORKER_SCHEDULER_ENABLED ?? 'true')) throw new Error('WORKER_CONFIG_INVALID: WORKER_SCHEDULER_ENABLED');
  if (config.heartbeatMs * 3 >= config.timeoutMs) {
    throw new Error('WORKER_CONFIG_INVALID: heartbeat × 3 doit être inférieur au timeout du job');
  }
  return config;
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  try { await delay(ms, undefined, { signal }); }
  catch (error) { if (!signal.aborted) throw error; }
}

/** Boucles non chevauchantes : jobs séquentiels, maintenance indépendante.
 * La maintenance et le heartbeat gardent des connexions réservées/bornées pour
 * ne pas être bloqués derrière un handler métier long. Garantie at-least-once.
 */
export async function runWorker(
  pool: Pool,
  handlers: JobHandlers,
  drainNotifications: () => Promise<void>,
  reportError: (error: unknown) => void,
): Promise<void> {
  const config = workerConfig();
  const control = new Pool({
    ...pool.options, max: 2,
    connectionTimeoutMillis: config.heartbeatMs * 2,
    statement_timeout: config.heartbeatMs * 2,
    query_timeout: config.heartbeatMs * 2,
  });
  let stopping = false;
  let shutdownTimer: NodeJS.Timeout | undefined;
  const stopWaits = new AbortController();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('[worker] arrêt demandé — plus de nouveaux claims, travail en cours conservé');
    stopWaits.abort();
    shutdownTimer = setTimeout(() => {
      console.error('[worker] WORKER_SHUTDOWN_TIMEOUT — sortie forcée, reprise par expiration du bail');
      process.exit(1);
    }, config.shutdownMs);
    shutdownTimer.unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const fatalLease = (error: unknown): never => {
    reportError(error);
    console.error('[worker] JOB_LEASE_LOST — arrêt pour ne pas poursuivre une tentative non possédée');
    process.exit(1);
  };

  async function reap(): Promise<void> {
    let count: number;
    do {
      count = (await control.query('SELECT jobs_reap_stale($1::interval) AS n', [`${config.timeoutMs} milliseconds`])).rows[0].n;
      if (count) console.log(`[worker] jobs_reap_stale : ${count} job(s) repris/échoués après expiration du bail`);
    } while (count === 500 && !stopping);
  }

  async function maintenance(): Promise<void> {
    while (!stopping) {
      await pause(config.reaperMs, stopWaits.signal);
      if (stopping) break;
      try { await reap(); }
      catch (error) { reportError(error); }
    }
  }

  const overdueReported = new Set<string>();
  async function businessPulse(): Promise<void> {
    await control.query('SELECT exports_fail_stale($1::interval)', [`${config.exportMaxAgeMs} milliseconds`]);
    if (!config.schedulerEnabled) return;
    const queued = (await control.query('SELECT scheduler_enqueue_due() AS n')).rows[0].n;
    if (queued) console.log(`[worker] scheduler : ${queued} job(s) planifié(s)`);
    const health = await control.query<{ job_type: string; overdue: boolean }>('SELECT * FROM scheduler_health()');
    for (const row of health.rows) {
      if (row.overdue && !overdueReported.has(row.job_type)) {
        reportError(new Error(`SCHEDULER_OVERDUE: ${row.job_type}`));
        overdueReported.add(row.job_type);
      } else if (!row.overdue) overdueReported.delete(row.job_type);
    }
  }
  async function schedules(): Promise<void> {
    while (!stopping) {
      await pause(config.schedulePollMs,stopWaits.signal);
      if (stopping) break;
      try { await businessPulse(); } catch (error) { reportError(error); }
    }
  }

  async function nextJob(): Promise<boolean> {
    if (stopping) return false;
    const client = await pool.connect();
    let job: ClaimedJob;
    try {
      await client.query('BEGIN');
      const claimed = await client.query<ClaimedJob>('SELECT * FROM jobs_claim_leased()');
      if (!claimed.rows[0] || stopping) {
        await client.query('ROLLBACK');
        return false;
      }
      job = claimed.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }

    const heartbeatStop = new AbortController();
    const heartbeat = (async () => {
      while (!heartbeatStop.signal.aborted) {
        await pause(config.heartbeatMs, heartbeatStop.signal);
        if (heartbeatStop.signal.aborted) break;
        const { rows: [result] } = await control.query(
          'SELECT jobs_heartbeat($1,$2) AS owned', [job.id, job.lease_token],
        );
        if (!result.owned) throw new Error(`JOB_LEASE_LOST: ${job.id}`);
      }
    })().catch(fatalLease);

    let failure: string | null = null;
    let exportTimer: NodeJS.Timeout | undefined;
    let exportTimedOut = false;
    try {
      const handler = handlers[job.job_type];
      if (!handler) throw new Error(`Type de job inconnu: ${job.job_type}`);
      const work = handler(job.payload, job.organization_id, job);
      if (job.job_type === 'export_report') {
        await Promise.race([work, new Promise<never>((_resolve,reject) => {
          exportTimer = setTimeout(() => { exportTimedOut=true; reject(new Error('EXPORT_TIMEOUT')); },config.exportTimeoutMs);
        })]);
      } else await work;
    } catch (error) {
      reportError(error);
      failure = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    } finally {
      // Plus de heartbeat en vol quand finish efface le jeton : pas de faux
      // JOB_LEASE_LOST causé par notre propre terminaison.
      if (exportTimer) clearTimeout(exportTimer);
      heartbeatStop.abort();
      await heartbeat;
    }
    try {
      if (exportTimedOut) {
        await control.query('SELECT exports_fail_job($1,$2)',[job.id,job.lease_token]);
        // Ne pas laisser le handler perdant de Promise.race continuer à écrire.
        console.error('[worker] EXPORT_TIMEOUT — échec terminal et arrêt du processus');
        process.exit(1);
      }
      const { rows: [result] } = await control.query(
        'SELECT jobs_finish_leased($1,$2,$3,$4) AS owned',
        [job.id, job.lease_token, failure === null, failure],
      );
      if (!result.owned) fatalLease(new Error(`JOB_LEASE_LOST: ${job.id}`));
    } catch (error) { fatalLease(error); }
    return true;
  }

  let maintenanceTask: Promise<void> | undefined;
  let scheduleTask: Promise<void> | undefined;
  try {
    // Reprise dès le boot, pas seulement après la première période de 5 min.
    await reap();
    await businessPulse();
    console.log('[worker] démarré — jobs avec baux (053) + FCM HTTP v1 / APNs');
    maintenanceTask = maintenance();
    scheduleTask = schedules();
    while (!stopping) {
      try {
        const had = await nextJob();
        // Ne pas réclamer une nouvelle batch de notifications après SIGTERM.
        // Si une batch était déjà réclamée, drainNotifications la termine.
        if (!stopping) await drainNotifications();
        if (!had && !stopping) await pause(config.pollMs, stopWaits.signal);
      } catch (error) {
        reportError(error);
        if (!stopping) await pause(config.pollMs, stopWaits.signal);
      }
    }
  } finally {
    stopping = true;
    stopWaits.abort();
    await Promise.all([maintenanceTask,scheduleTask]);
    await Promise.all([control.end(), pool.end()]);
    if (shutdownTimer) clearTimeout(shutdownTimer);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
  console.log('[worker] arrêt propre — travail en cours terminé, pools fermés');
}
