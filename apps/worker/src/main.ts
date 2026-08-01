import { Pool } from 'pg';

/**
 * Worker asynchrone — Phase 6.
 * Consomme background_jobs (FOR UPDATE SKIP LOCKED, multi-instance safe)
 * et draine notification_queue (push FCM réel branché en Phase 7).
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

const JOB_HANDLERS: Record<string, (payload: unknown, orgId: string | null) => Promise<void>> = {
  send_parent_notification: async () => {
    // Phase 7 : envoi FCM/APNs réel via fcm_token des devices.
    // Le contenu est déjà dans notification_queue (NotificationsService).
  },
  compress_media: async () => {
    // Phase 7 : re-compression des photos via worker.
  },
  generate_invoice_pdf: async () => {
    // Phase 8 : génération PDF (Puppeteer).
  },
  send_monthly_invoices: async () => {
    // Phase 8.
  },
  export_report: async () => {
    // Phase 8.
  },
};

async function processNextJob(): Promise<boolean> {
  const client = await pool.connect();
  let jobId: string | null = null;
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT id, job_type, payload, organization_id, attempts
       FROM background_jobs
       WHERE status = 'pending' AND scheduled_at <= NOW() AND attempts < max_attempts
       ORDER BY priority DESC, scheduled_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    const job = res.rows[0] as {
      id: string; job_type: string; payload: unknown; organization_id: string | null; attempts: number;
    };
    jobId = job.id;
    await client.query(
      `UPDATE background_jobs SET status = 'processing', started_at = NOW(), attempts = attempts + 1
       WHERE id = $1`,
      [job.id],
    );
    await client.query('COMMIT');

    const handler = JOB_HANDLERS[job.job_type];
    if (!handler) {
      throw new Error(`Type de job inconnu: ${job.job_type}`);
    }
    await handler(job.payload, job.organization_id);

    await pool.query(
      `UPDATE background_jobs SET status = 'done', completed_at = NOW() WHERE id = $1`,
      [job.id],
    );
    return true;
  } catch (error) {
    if (jobId) {
      await pool.query(
        `UPDATE background_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
             failed_at = NOW(), failure_reason = $1,
             scheduled_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts))
         WHERE id = $2`,
        [String((error as Error).message), jobId],
      );
    }
    return true;
  } finally {
    client.release();
  }
}

/** Marque les notifications en file comme envoyées (stub push — FCM en Phase 7). */
async function drainNotificationQueue(): Promise<void> {
  const res = await pool.query(
    `UPDATE notification_queue
     SET status = 'sent', sent_at = NOW()
     WHERE id IN (
       SELECT id FROM notification_queue
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY created_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
  );
  if ((res.rowCount ?? 0) > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${res.rowCount} notification(s) marquée(s) envoyée(s) (stub FCM — Phase 7)`);
  }
}

async function run(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[worker] démarré — Phase 6');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hadJob = await processNextJob();
    await drainNotificationQueue();
    if (!hadJob) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal:', error);
  process.exit(1);
});
