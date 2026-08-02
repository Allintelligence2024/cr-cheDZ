import { GoogleAuth } from 'google-auth-library';
import { createSign } from 'node:crypto';
import * as http2 from 'node:http2';
import { Pool, PoolClient } from 'pg';
import { buildXlsx, storeExport, type ExportPayload } from './exports';
import { buildInvoicePdf, storePdf } from './pdf';

/**
 * Worker : jobs transactionnels + livraison push (FCM HTTP v1 / APNs).
 *
 * RLS : le worker tourne avec le rôle applicatif NOBYPASSRLS. Le claim et la
 * terminaison des jobs passent par jobs_claim_next()/jobs_finish()
 * (SECURITY DEFINER, migration 024 — même pattern bootstrap que l'auth) ;
 * TOUT accès aux données métier (invoices, children, …) se fait dans une
 * transaction avec SET LOCAL app.tenant_id (withTenant).
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as { project_id: string }
  : null;
const googleAuth = firebaseCredentials
  ? new GoogleAuth({ credentials: firebaseCredentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })
  : null;

// ── Helpers tenant (RLS) ────────────────────────────────────────────────────

/** Transaction avec SET LOCAL app.tenant_id : accès tenant obligatoire. */
async function withTenant<T>(orgId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ── Jobs métier ─────────────────────────────────────────────────────────────

interface ClaimedJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  organization_id: string | null;
  attempts: number;
  max_attempts: number;
}

/** generate_invoice_pdf : PDF réel → stockage (local/S3) → invoices.pdf_url. */
async function generateInvoicePdf(job: ClaimedJob): Promise<void> {
  const orgId = job.organization_id;
  if (!orgId) throw new Error('ORGANIZATION_REQUIRED');
  const invoiceId = String((job.payload as { invoice_id?: unknown }).invoice_id);
  if (!invoiceId) throw new Error('INVOICE_ID_REQUIRED');

  const data = await withTenant(orgId, async (client) => {
    const invoice = (await client.query(
      `SELECT i.invoice_number, i.period_year, i.period_month, i.subtotal, i.discount_amount,
              i.total_amount, i.due_date, i.created_at,
              ch.first_name_fr, ch.last_name_fr, o.name_fr AS org_name
       FROM invoices i
       JOIN children ch ON ch.id = i.child_id
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.id = $1`, [invoiceId],
    )).rows[0];
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    const lines = (await client.query(
      `SELECT description_fr, quantity, unit_price, total_price FROM invoice_lines
       WHERE invoice_id = $1 ORDER BY sort_order, id`, [invoiceId],
    )).rows;
    return { invoice, lines };
  });

  const pdf = await buildInvoicePdf({
    orgName: data.invoice.org_name ?? 'Crèche',
    invoiceNumber: data.invoice.invoice_number,
    periodLabel: `${String(data.invoice.period_month).padStart(2, '0')}/${data.invoice.period_year}`,
    dueDate: data.invoice.due_date.toISOString?.().slice(0, 10) ?? String(data.invoice.due_date),
    childName: `${data.invoice.first_name_fr} ${data.invoice.last_name_fr}`.trim(),
    lines: data.lines.map((l: { description_fr: string; quantity: string; unit_price: string; total_price: string }) => ({
      description: l.description_fr,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      total: Number(l.total_price),
    })),
    subtotal: Number(data.invoice.subtotal),
    discount: Number(data.invoice.discount_amount),
    total: Number(data.invoice.total_amount),
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });

  const key = `${orgId}/invoices/${invoiceId}.pdf`;
  await storePdf(key, pdf);
  await withTenant(orgId, async (client) => {
    await client.query(`UPDATE invoices SET pdf_url = $2, updated_at = NOW() WHERE id = $1`, [invoiceId, key]);
  });
}

/** send_monthly_invoices : génération mensuelle idempotente pour tous les contrats actifs. */
async function sendMonthlyInvoices(job: ClaimedJob): Promise<void> {
  const orgId = job.organization_id;
  if (!orgId) throw new Error('ORGANIZATION_REQUIRED');
  const payload = job.payload as { period_year?: number; period_month?: number; due_date?: string };
  if (!payload.period_year || !payload.period_month || !payload.due_date) throw new Error('PAYLOAD_INCOMPLET');
  const { period_year: year, period_month: month, due_date: dueDate } = payload;

  const created: string[] = [];
  await withTenant(orgId, async (client) => {
    const contracts = (await client.query(
      `SELECT * FROM contracts WHERE is_active = true
         AND (end_date IS NULL OR end_date >= $1::date)`,
      [`${year}-${String(month).padStart(2, '0')}-01`],
    )).rows;
    for (const contract of contracts) {
      const subtotal = Number(contract.monthly_base_amount)
        + (contract.includes_meals ? Number(contract.meal_amount ?? 0) : 0)
        + (contract.includes_transport ? Number(contract.transport_amount ?? 0) : 0);
      const discount = Math.round(subtotal * Number(contract.discount_percent ?? 0)) / 100;
      const total = subtotal - discount;
      const seq = (await client.query(`SELECT next_org_sequence($1) AS n`, [orgId])).rows[0].n;
      const invoiceNumber = `FAC-${year}${String(month).padStart(2, '0')}-${seq}`;
      // L'index unique partiel (021) garantit UNE facture par contrat/période,
      // même si deux jobs tournent en parallèle (ON CONFLICT DO NOTHING).
      const inserted = (await client.query(
        `INSERT INTO invoices (organization_id, invoice_number, child_id, contract_id, period_year, period_month,
                               subtotal, discount_amount, total_amount, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING RETURNING id`,
        [orgId, invoiceNumber, contract.child_id, contract.id, year, month, subtotal, discount, total, dueDate, contract.created_by],
      )).rows[0];
      if (!inserted) continue; // facture déjà générée → idempotent
      created.push(inserted.id);
      await client.query(
        `INSERT INTO invoice_lines (organization_id, invoice_id, description_fr, description_ar, quantity, unit_price, total_price, line_type)
         VALUES ($1,$2,'Garde mensuelle','الرعاية الشهرية',1,$3,$3,'care')`,
        [orgId, inserted.id, subtotal],
      );
      if (contract.includes_meals) {
        await client.query(
          `INSERT INTO invoice_lines (organization_id, invoice_id, description_fr, description_ar, quantity, unit_price, total_price, line_type)
           VALUES ($1,$2,'Repas','الوجبات',1,$3,$3,'meal')`,
          [orgId, inserted.id, Number(contract.meal_amount ?? 0)],
        );
      }
      if (contract.includes_transport) {
        await client.query(
          `INSERT INTO invoice_lines (organization_id, invoice_id, description_fr, description_ar, quantity, unit_price, total_price, line_type)
           VALUES ($1,$2,'Transport','النقل',1,$3,$3,'transport')`,
          [orgId, inserted.id, Number(contract.transport_amount ?? 0)],
        );
      }
    }
  });

  // Une fois la génération mensuelle committée, on planifie les PDF (même
  // transaction d'écriture jobs, tenant posé) pour les nouvelles factures.
  await withTenant(orgId, async (client) => {
    for (const invoiceId of created) {
      await client.query(
        `INSERT INTO background_jobs (organization_id, job_type, payload, priority)
         VALUES ($1, 'generate_invoice_pdf', $2, 2)`,
        [orgId, JSON.stringify({ invoice_id: invoiceId })],
      );
    }
  });
}

/** retention_purge : purge des journaux au-delà de RETENTION_DAYS (défaut 1825 j). */
async function retentionPurge(): Promise<void> {
  const days = Number(process.env.RETENTION_DAYS ?? 1825);
  const r = await pool.query(`SELECT retention_purge_logs(NOW() - ($1::int || ' days')::interval) AS purged`, [days]);
  console.log(`[worker] retention_purge : ${r.rows[0].purged} ligne(s) purgée(s) (> ${days} j)`);
}

/** export_report : génère le fichier Excel (présences/factures) et enregistre report_exports. */
async function exportReport(job: ClaimedJob): Promise<void> {
  const orgId = job.organization_id;
  if (!orgId) throw new Error('ORGANIZATION_REQUIRED');
  const payload = job.payload as unknown as ExportPayload;
  if (!payload?.export_id || !payload.report_type) throw new Error('PAYLOAD_INCOMPLET');

  const rows = await withTenant(orgId, async (client) => {
    if (payload.report_type === 'attendance') {
      const [start, end] = payload.range;
      const res = await client.query(
        `SELECT c.reference_number, c.first_name_fr, c.last_name_fr,
                COALESCE(r.name_fr, '—') AS salle, s.session_date AS date,
                s.status AS statut,
                to_char((SELECT e.occurred_at FROM attendance_events e
                   WHERE e.session_id = s.id AND e.event_type='check_in'
                   ORDER BY e.occurred_at LIMIT 1), 'HH24:MI') AS arrivee,
                to_char((SELECT e.occurred_at FROM attendance_events e
                   WHERE e.session_id = s.id AND e.event_type='check_out'
                   ORDER BY e.occurred_at DESC LIMIT 1), 'HH24:MI') AS depart
         FROM attendance_sessions s
         JOIN children c ON c.id = s.child_id
         LEFT JOIN rooms r ON r.id = c.room_id
         WHERE s.organization_id = $1 AND s.session_date BETWEEN $2 AND $3
         ORDER BY s.session_date, c.last_name_fr`,
        [orgId, start, end],
      );
      return res.rows.map((row) => ({
        reference: row.reference_number,
        prenom: row.first_name_fr,
        nom: row.last_name_fr,
        salle: row.salle,
        date: String(row.date).slice(0, 10),
        statut: row.statut,
        arrivee: row.arrivee ?? '',
        depart: row.depart ?? '',
      }));
    }
    // invoices
    const [year, month] = payload.range;
    const res = await client.query(
      `SELECT i.invoice_number, c.first_name_fr || ' ' || c.last_name_fr AS enfant,
              i.period_year || '/' || i.period_month AS periode,
              i.total_amount, i.paid_amount, i.balance, i.status, i.due_date
       FROM invoices i JOIN children c ON c.id = i.child_id
       WHERE i.organization_id = $1 AND i.period_year = $2
         AND ($3::int IS NULL OR i.period_month = $3)
       ORDER BY i.period_year, i.period_month, i.invoice_number`,
      [orgId, Number(year), month ? Number(month) : null],
    );
    return res.rows.map((row) => ({
      n_facture: row.invoice_number,
      enfant: row.enfant,
      periode: row.periode,
      total_dzd: Number(row.total_amount),
      paye_dzd: Number(row.paid_amount),
      solde_dzd: Number(row.balance),
      statut: row.status,
      echeance: String(row.due_date).slice(0, 10),
    }));
  });

  const xlsx = await buildXlsx(payload.report_type, rows);
  const key = await storeExport(orgId, payload.export_id, xlsx);
  await withTenant(orgId, async (client) => {
    await client.query(
      `UPDATE report_exports SET status='done', storage_key=$2, file_size_bytes=$3, completed_at=NOW()
       WHERE id=$1`,
      [payload.export_id, key, xlsx.length],
    );
  });
}

const JOB_HANDLERS: Record<string, (payload: unknown, orgId: string | null, job: ClaimedJob) => Promise<void>> = {
  generate_invoice_pdf: (_p, _o, job) => generateInvoicePdf(job),
  send_monthly_invoices: (_p, _o, job) => sendMonthlyInvoices(job),
  retention_purge: () => retentionPurge(),
  // La livraison des notifications passe par notification_queue (drain
  // ci-dessous) : ce job marque la prise en charge, le drain ne passe la file
  // en 'sent' qu'après traitement, avec failure_reason explicite
  // (PUSH_NOT_CONFIGURED_OR_NO_DEVICE) si aucun push n'a réellement été
  // délivré — jamais de faux statut, l'inbox reste la voie fiable.
  send_parent_notification: async (_payload, orgId) => {
    if (!orgId) throw new Error('ORGANIZATION_REQUIRED');
  },
  export_report: (_p, _o, job) => exportReport(job),
  // Intégration non configurée dans cette session (stub explicite, jamais de
  // faux statut : le job échoue avec un message clair si invoqué).
  compress_media: async () => { throw new Error('NOT_IMPLEMENTED: compression média'); },
};

async function processNextJob(): Promise<boolean> {
  const client = await pool.connect();
  let jobId: string | null = null;
  try {
    // Claim + passage en 'processing' dans UNE transaction (verrou SKIP LOCKED
    // effectif), via la fonction SECURITY DEFINER jobs_claim_next (024).
    await client.query('BEGIN');
    const claimed = await client.query(
      `SELECT id, job_type, payload, organization_id, attempts, max_attempts FROM jobs_claim_next()`,
    );
    if (!claimed.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    jobId = claimed.rows[0].id as string;
    await client.query('COMMIT');
    const job = claimed.rows[0] as ClaimedJob;
    const handler = JOB_HANDLERS[job.job_type];
    if (!handler) throw new Error(`Type de job inconnu: ${job.job_type}`);
    await handler(job.payload, job.organization_id, job);
    await pool.query(`SELECT jobs_finish($1, true)`, [job.id]);
    return true;
  } catch (error) {
    if (jobId) {
      const reason = error instanceof Error ? error.message : String(error);
      await pool.query(`SELECT jobs_finish($1, false, $2)`, [jobId, reason.slice(0, 500)]);
    }
    return true;
  } finally {
    client.release();
  }
}

// ── Push FCM HTTP v1 / APNs ─────────────────────────────────────────────────

async function fcmSend(token: string, notification: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  if (!googleAuth || !firebaseCredentials) throw new Error('FCM_NOT_CONFIGURED');
  const client = await googleAuth.getClient();
  const headers = await client.getRequestHeaders();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${firebaseCredentials.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: notification.title, body: notification.body },
          data: notification.data,
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`FCM_${response.status}:${(await response.text()).slice(0, 300)}`);
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** WhatsApp Business (roadmap v2) : API Graph Meta — 503 explicite sans config. */
async function whatsappSend(body: string, data: Record<string, unknown>): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error('WHATSAPP_NOT_CONFIGURED');
  const apiUrl = process.env.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v19.0';
  const to = data.to ? String(data.to) : null;
  if (!to) throw new Error('WHATSAPP_NO_RECIPIENT');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${apiUrl}/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`WHATSAPP_${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}
/** APNs HTTP/2 direct, avec JWT ES256 Apple renouvelé à chaque livraison. */
async function apnsSend(token: string, notification: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const topic = process.env.APNS_BUNDLE_ID;
  const key = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!keyId || !teamId || !topic || !key) throw new Error('APNS_NOT_CONFIGURED');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const jwt = `${header}.${payload}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const host = process.env.APNS_PRODUCTION === 'true' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  await new Promise<void>((resolve, reject) => {
    const client = http2.connect(host);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('response', (headers) => {
      const status = Number(headers[':status']);
      if (status === 200) resolve();
      else reject(new Error(`APNS_${status}:${body.slice(0, 300)}`));
    });
    req.on('error', reject);
    req.on('close', () => client.close());
    req.end(JSON.stringify({ aps: { alert: { title: notification.title, body: notification.body }, sound: 'default' }, ...notification.data }));
  });
}

/** Drain notification_queue (migration 042) : claim/finish via SECURITY DEFINER
 *  (sans tenant posé, la RLS rendait la file invisible sous NOBYPASSRLS). */
async function drainNotificationQueue(): Promise<void> {
  const client = await pool.connect();
  try {
    const claimed = await client.query(`SELECT id, organization_id, user_id, channel, title_fr, title_ar, body_fr, body_ar, data FROM notif_queue_claim(25)`);
    for (const n of claimed.rows) {
      // Canal WhatsApp : envoi via l'API Graph — flag vérifié à l'insertion.
      if (n.channel === 'whatsapp') {
        try {
          await whatsappSend(n.body_fr, n.data);
          await client.query(`SELECT notif_queue_finish($1, true)`, [n.id]);
        } catch (error) {
          await client.query(`SELECT notif_queue_finish($1, false, $2)`, [n.id, String((error as Error).message).slice(0, 500)]);
        }
        continue;
      }
      // Canal push : les appareils sont lus DANS le tenant (RLS).
      const devices = await withTenant(n.organization_id, async (c) => c.query(
        `SELECT platform, fcm_token, apns_token FROM devices
         WHERE organization_id=$1 AND registered_by=$2 AND is_active=true AND revoked_at IS NULL
           AND (fcm_token IS NOT NULL OR apns_token IS NOT NULL)`,
        [n.organization_id, n.user_id],
      ));
      try {
        const message = {
          title: n.title_fr,
          body: n.body_fr,
          data: Object.fromEntries(Object.entries(n.data ?? {}).map(([k, v]) => [k, String(v)])),
        };
        let delivered = false;
        for (const d of devices.rows) {
          if (d.fcm_token && googleAuth) { await fcmSend(d.fcm_token, message); delivered = true; }
          else if (d.platform === 'ios' && d.apns_token) { await apnsSend(d.apns_token, message); delivered = true; }
        }
        // Sans jeton/configuration, l'inbox reste la voie fiable ; ne jamais
        // marquer 'sent' si rien n'a été livré, ni journaliser de token.
        await client.query(`SELECT notif_queue_finish($1, true, $2)`, [n.id, delivered ? null : 'PUSH_NOT_CONFIGURED_OR_NO_DEVICE']);
      } catch (error) {
        await client.query(`SELECT notif_queue_finish($1, false, $2)`, [n.id, String((error as Error).message).slice(0, 500)]);
      }
    }
  } finally {
    client.release();
  }
}

/** Sentry (Phase 11) : actif uniquement avec SENTRY_DSN. */
let sentry: typeof import('@sentry/node') | null = null;
async function initSentry(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  sentry = await import('@sentry/node');
  sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

async function run(): Promise<void> {
  await initSentry();
  console.log('[worker] démarré — jobs (024) + FCM HTTP v1 / APNs');
  for (;;) {
    try {
      const had = await processNextJob();
      await drainNotificationQueue();
      if (!had) await new Promise((r) => setTimeout(r, 2000));
    } catch (error) {
      sentry?.captureException(error);
      console.error('[worker] boucle:', error instanceof Error ? error.message : String(error));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

run().catch((error) => { console.error('[worker] fatal:', error); process.exit(1); });
