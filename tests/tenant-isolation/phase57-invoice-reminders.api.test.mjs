#!/usr/bin/env node
/**
 * Phase 57 GATE — P2-3 impayés & relances (migration 068), PostgreSQL réel,
 * rôle applicatif NOBYPASSRLS, serveur SMTP RÉEL éphémère (net) pour prouver
 * la transmission et le fail-closed.
 *
 * Cas couverts :
 *   1. facture 'draft' : ni impayé, ni relançable (422 INVOICE_NOT_RECEIVABLE) ;
 *      POST /send → 'sent' ; second POST /send → 409 ;
 *   2. balance âgée : échéance dépassée ⇒ transition overdue À LA LECTURE,
 *      tranche d31_60, totaux exacts ; facture non échue reste 'sent' ;
 *   3. relance email niveau 1 : le SMTP reçoit un message (destinataire =
 *      tuteur facturable, sujet contient le n° de facture, solde, FR + AR) ;
 *      ligne invoice_reminders écrite ; niveau 1 rejoué → 409 ;
 *   4. séquence : niveau 3 sans niveau 2 → 422 ; niveau 2 manuel sans notes
 *      → 400 ; niveau 2 manuel avec notes → 201 (aucun email) ;
 *   5. FAIL-CLOSED : SMTP arrêté → niveau 3 email → 502 EMAIL_DELIVERY_FAILED
 *      et AUCUNE ligne niveau 3 ; sans transport configuré (EMAIL_PROVIDER=none
 *      hors development) → 503 REMINDER_DELIVERY_UNAVAILABLE, aucune ligne ;
 *   6. enfant sans tuteur emailable → 422 REMINDER_NO_RECIPIENT ;
 *   7. isolation : B ne lit pas la balance/relances de A ; B ne relance pas la
 *      facture de A (404) ; SQL direct sous rôle app hors tenant → 0 ligne ;
 *   8. paiement soldant la facture overdue → 'paid', disparaît de la balance ;
 *      relance sur facture payée → 422.
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

/** Serveur SMTP minimal (pas d'auth, pas de TLS) : capture les messages DATA. */
function startSmtp() {
  const messages = [];
  const server = createServer((socket) => {
    let buf = '';
    let inData = false;
    let current = null;
    socket.write('220 test.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') { inData = false; messages.push(current); current = null; socket.write('250 OK queued\r\n'); }
          else current.data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-test.local\r\n250-8BITMIME\r\n250 OK\r\n');
        else if (cmd === 'MAIL') { current = { from: line, to: [], data: '' }; socket.write('250 OK\r\n'); }
        else if (cmd === 'RCPT') { current.to.push(line.replace(/^RCPT TO:\s*<?/i, '').replace(/>.*$/, '')); socket.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else if (cmd === 'RSET' || cmd === 'NOOP') socket.write('250 OK\r\n');
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, messages, port: server.address().port })));
}

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);

  const smtp = await startSmtp();
  Object.assign(process.env, {
    DATABASE_URL: appUrl(), RATE_LIMIT_DISABLED: 'true', NODE_ENV: 'test', SENTRY_DSN: '',
    EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false', SMTP_FROM: 'noreply@test.dz',
  });

  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  let app = await createApp();
  await app.listen(0);
  let base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `p57-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 4);
  const cleanupOrgs = `(SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`;

  try {
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const mkOrg = async (slug, name) => {
      const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,$2,'31') RETURNING id`, [slug, name]);
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`, 'Crèche A');
    const B = await mkOrg(`${tag}-b`, 'Crèche B');
    const mkChild = async (O, ref, first) => (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,$4,$5,'Test','2024-01-01',$6) RETURNING id`, [O.org, O.site, O.room, ref, first, O.director])).rows[0].id;
    const childA = await mkChild(A, 'P57-1', 'Yanis');
    const childA2 = await mkChild(A, 'P57-2', 'Sarah'); // sans tuteur emailable
    const childB = await mkChild(B, 'P57-3', 'Lina');
    // Tuteurs de Yanis : un secondaire avec email, un primaire facturable avec email → le facturable gagne.
    const mkGuardian = async (O, childId, email, canReceive, isPrimary) => {
      const g = await db.query(`INSERT INTO guardians(organization_id,first_name_fr,last_name_fr,relationship,email,created_by) VALUES($1,'G','T','parent',$2,$3) RETURNING id`, [O.org, email, O.director]);
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_primary,can_receive_invoices) VALUES($1,$2,$3,$4,$5)`, [O.org, childId, g.rows[0].id, isPrimary, canReceive]);
      return g.rows[0].id;
    };
    await mkGuardian(A, childA, `${tag}-secondaire@test.dz`, false, false);
    const billableGuardian = await mkGuardian(A, childA, `${tag}-facturable@test.dz`, true, true);
    await mkGuardian(B, childB, `${tag}-parent-b@test.dz`, true, true);

    const login = async (email) => (await api('POST', '/auth/login', null, { email, password })).body.access_token;
    let tokenA = await login(`${tag}-a-director@test.dz`);
    const tokenB = await login(`${tag}-b-director@test.dz`);
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: childA, monthly_base_amount: 12000, start_date: '2026-01-01' })).body;
    const contract2 = (await api('POST', '/billing/contracts', tokenA, { child_id: childA2, monthly_base_amount: 5000, start_date: '2026-01-01' })).body;
    const contractB = (await api('POST', '/billing/contracts', tokenB, { child_id: childB, monthly_base_amount: 9000, start_date: '2026-01-01' })).body;
    // Échéance il y a 45 jours (Alger) → tranche d31_60.
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const dueLate = iso(new Date(today.getTime() - 45 * 86400e3));
    const dueFuture = iso(new Date(today.getTime() + 20 * 86400e3));
    const invLate = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 6, due_date: dueLate })).body;
    const invFuture = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: 2026, period_month: 9, due_date: dueFuture })).body;
    const invNoMail = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract2.id, period_year: 2026, period_month: 6, due_date: dueLate })).body;
    const invB = (await api('POST', '/billing/invoices/generate', tokenB, { contract_id: contractB.id, period_year: 2026, period_month: 6, due_date: dueLate })).body;
    ok('Factures générées (A ×3, B ×1)', [invLate, invFuture, invNoMail, invB].every((i) => i && i.id));

    // ── 1. draft ────────────────────────────────────────────────────────────
    console.log('\n1) Brouillon : ni impayé ni relançable ; émission');
    let aged = await api('GET', '/billing/invoices/aged-balance', tokenA);
    ok('Balance âgée : aucune facture (toutes en draft)', aged.status === 200 && aged.body.invoices.length === 0, JSON.stringify(aged.body).slice(0, 160));
    const remDraft = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 1, channel: 'email' });
    ok('Relance sur draft → 422 INVOICE_NOT_RECEIVABLE', remDraft.status === 422 && remDraft.body.code === 'INVOICE_NOT_RECEIVABLE', JSON.stringify(remDraft.body).slice(0, 120));
    const sent = await api('POST', `/billing/invoices/${invLate.id}/send`, tokenA);
    ok('POST /send : draft → sent avec sent_at', sent.status === 200 && sent.body.status === 'sent' && sent.body.sent_at, JSON.stringify(sent.body).slice(0, 120));
    const sentAgain = await api('POST', `/billing/invoices/${invLate.id}/send`, tokenA);
    ok('Second /send → 409 INVOICE_ALREADY_SENT', sentAgain.status === 409 && sentAgain.body.code === 'INVOICE_ALREADY_SENT');
    for (const inv of [invFuture, invNoMail]) await api('POST', `/billing/invoices/${inv.id}/send`, tokenA);
    await api('POST', `/billing/invoices/${invB.id}/send`, tokenB);

    // ── 2. balance âgée + overdue ───────────────────────────────────────────
    console.log('\n2) Balance âgée : transition overdue à la lecture');
    aged = await api('GET', '/billing/invoices/aged-balance', tokenA);
    const rowLate = aged.body.invoices.find((i) => i.id === invLate.id);
    const rowFuture = aged.body.invoices.find((i) => i.id === invFuture.id);
    ok('Facture échue → status overdue, days_overdue ≈ 45, tranche d31_60', rowLate && rowLate.status === 'overdue' && rowLate.aging_bucket === 'd31_60' && Math.abs(Number(rowLate.days_overdue) - 45) <= 1, JSON.stringify(rowLate));
    ok('Facture non échue reste sent, tranche not_due', rowFuture && rowFuture.status === 'sent' && rowFuture.aging_bucket === 'not_due', JSON.stringify(rowFuture));
    ok('Totaux : overdue_total = 17000 (12000 + 5000), outstanding_total = 29000, overdue_count = 2',
      Number(aged.body.totals.overdue_total) === 17000 && Number(aged.body.totals.outstanding_total) === 29000 && aged.body.totals.overdue_count === 2 && Number(aged.body.totals.d31_60) === 17000,
      JSON.stringify(aged.body.totals));
    const dbStatus = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invLate.id])).rows[0].status;
    ok('Statut overdue persisté en base', dbStatus === 'overdue', dbStatus);

    // ── 3. relance email réelle ─────────────────────────────────────────────
    console.log('\n3) Relance email niveau 1 — transmission SMTP réelle');
    const before = smtp.messages.length;
    const r1 = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 1, channel: 'email' });
    ok('Niveau 1 email → 201, balance_due 12000, guardian = tuteur facturable', r1.status === 201 && Number(r1.body.balance_due) === 12000 && r1.body.guardian_id === billableGuardian && r1.body.level === 1, JSON.stringify(r1.body).slice(0, 200));
    const msg = smtp.messages[before];
    ok('SMTP : exactement un message reçu, destinataire = tuteur facturable (pas le secondaire)', smtp.messages.length === before + 1 && msg && msg.to.length === 1 && msg.to[0] === `${tag}-facturable@test.dz`, JSON.stringify(msg && msg.to));
    const raw = msg ? msg.data : '';
    // Décodage MIME grossier : parties quoted-printable et base64 concaténées en UTF-8.
    const decodeMime = (m) => {
      const out = [];
      for (const part of m.split(/\r?\n--[^\r\n]+/)) {
        const [head, ...bodyParts] = part.split(/\n\n/); const body = bodyParts.join('\n\n');
        if (/base64/i.test(head)) out.push(Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'));
        else if (/quoted-printable/i.test(head)) out.push(Buffer.from(body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
        else out.push(body);
      }
      return out.join('\n');
    };
    const decoded = decodeMime(raw);
    ok('Message : n° de facture, montant 12 000, FR + AR, aucun secret/jeton', decoded.includes(invLate.invoice_number) && /12[\s\u00a0\u202f]?000/.test(decoded) && /Rappel de paiement/.test(decoded) && /تذكير بالدفع/.test(decoded) && !/token=|Bearer /.test(raw), decoded.slice(0, 400));
    const rows1 = (await db.query(`SELECT level, channel, guardian_id FROM invoice_reminders WHERE invoice_id=$1 ORDER BY level`, [invLate.id])).rows;
    ok('invoice_reminders : 1 ligne niveau 1 email', rows1.length === 1 && rows1[0].level === 1 && rows1[0].channel === 'email');
    const r1bis = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 1, channel: 'email' });
    ok('Niveau 1 rejoué → 409 REMINDER_LEVEL_ALREADY_SENT, aucun nouvel email', r1bis.status === 409 && r1bis.body.code === 'REMINDER_LEVEL_ALREADY_SENT' && smtp.messages.length === before + 1);
    aged = await api('GET', '/billing/invoices/aged-balance', tokenA);
    ok('Balance âgée reflète last_reminder_level = 1', aged.body.invoices.find((i) => i.id === invLate.id).last_reminder_level === 1);

    // ── 4. séquence + manuel ────────────────────────────────────────────────
    console.log('\n4) Séquence des niveaux et relance manuelle');
    const skip = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 3, channel: 'email' });
    ok('Niveau 3 sans niveau 2 → 422 REMINDER_LEVEL_SEQUENCE', skip.status === 422 && skip.body.code === 'REMINDER_LEVEL_SEQUENCE');
    const noNotes = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 2, channel: 'manual' });
    ok('Manuel sans notes → 400 REMINDER_NOTES_REQUIRED', noNotes.status === 400 && noNotes.body.code === 'REMINDER_NOTES_REQUIRED');
    const badLevel = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 4, channel: 'manual', notes: 'x' });
    ok('Niveau 4 → 400 (validation DTO)', badLevel.status === 400);
    const manual = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 2, channel: 'manual', notes: 'Appel téléphonique au père, promesse de paiement vendredi' });
    ok('Niveau 2 manuel avec notes → 201, aucun email émis', manual.status === 201 && manual.body.channel === 'manual' && smtp.messages.length === before + 1, JSON.stringify(manual.body).slice(0, 120));
    const list = await api('GET', `/billing/invoices/${invLate.id}/reminders`, tokenA);
    ok('GET reminders : 2 lignes ordonnées (1 email, 2 manual)', list.status === 200 && list.body.length === 2 && list.body[0].level === 1 && list.body[1].channel === 'manual');

    // ── 5. fail-closed ──────────────────────────────────────────────────────
    console.log('\n5) Fail-closed : SMTP en panne / transport non configuré');
    await new Promise((resolve) => smtp.server.close(resolve));
    const down = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 3, channel: 'email' });
    ok('SMTP arrêté → 502 EMAIL_DELIVERY_FAILED', down.status === 502 && down.body.code === 'EMAIL_DELIVERY_FAILED', JSON.stringify(down.body).slice(0, 120));
    const rows3 = (await db.query(`SELECT count(*)::int AS n FROM invoice_reminders WHERE invoice_id=$1 AND level=3`, [invLate.id])).rows[0].n;
    ok('Aucune ligne niveau 3 écrite (transaction annulée)', rows3 === 0, `n=${rows3}`);
    await app.close();
    process.env.EMAIL_PROVIDER = 'none';
    app = await createApp(); await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    tokenA = await login(`${tag}-a-director@test.dz`);
    const unconfigured = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 3, channel: 'email' });
    ok('EMAIL_PROVIDER=none hors development → 503 REMINDER_DELIVERY_UNAVAILABLE', unconfigured.status === 503 && unconfigured.body.code === 'REMINDER_DELIVERY_UNAVAILABLE', JSON.stringify(unconfigured.body).slice(0, 120));
    ok('Toujours aucune ligne niveau 3', (await db.query(`SELECT count(*)::int AS n FROM invoice_reminders WHERE invoice_id=$1 AND level=3`, [invLate.id])).rows[0].n === 0);
    const manualStill = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 3, channel: 'manual', notes: 'Dernier rappel remis en main propre' });
    ok('Relance manuelle reste possible sans transport (201)', manualStill.status === 201);

    // ── 6. sans destinataire ────────────────────────────────────────────────
    console.log('\n6) Enfant sans tuteur emailable');
    await app.close();
    process.env.EMAIL_PROVIDER = 'smtp'; // transport « configuré » (hôte injoignable) : le contrôle destinataire précède l'envoi
    app = await createApp(); await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    tokenA = await login(`${tag}-a-director@test.dz`);
    const noRecipient = await api('POST', `/billing/invoices/${invNoMail.id}/reminders`, tokenA, { level: 1, channel: 'email' });
    ok('Aucun tuteur avec email → 422 REMINDER_NO_RECIPIENT', noRecipient.status === 422 && noRecipient.body.code === 'REMINDER_NO_RECIPIENT', JSON.stringify(noRecipient.body).slice(0, 120));

    // ── 7. isolation ────────────────────────────────────────────────────────
    console.log('\n7) Isolation tenant');
    const agedB = await api('GET', '/billing/invoices/aged-balance', tokenB);
    ok('B : balance âgée = uniquement sa facture (overdue 9000)', agedB.status === 200 && agedB.body.invoices.length === 1 && agedB.body.invoices[0].id === invB.id && Number(agedB.body.totals.overdue_total) === 9000, JSON.stringify(agedB.body).slice(0, 200));
    ok('B : GET reminders de la facture de A → 404', (await api('GET', `/billing/invoices/${invLate.id}/reminders`, tokenB)).status === 404);
    ok('B : relance sur la facture de A → 404', (await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenB, { level: 1, channel: 'manual', notes: 'x' })).status === 404);
    const appConn = new pg.Client({ connectionString: appUrl() });
    await appConn.connect();
    try {
      await appConn.query('BEGIN');
      await appConn.query(`SELECT set_config('app.tenant_id', $1, true)`, [B.org]);
      const leak = await appConn.query(`SELECT count(*)::int AS n FROM invoice_reminders`);
      ok('RLS : sous le tenant B, invoice_reminders de A invisibles (0)', leak.rows[0].n === 0, `n=${leak.rows[0].n}`);
      const cross = await appConn.query(`SELECT invoices_mark_overdue($1) AS n`, [A.org]);
      ok('invoices_mark_overdue(A) depuis le tenant B → 0 ligne (RLS, SECURITY INVOKER)', cross.rows[0].n === 0, `n=${cross.rows[0].n}`);
      await appConn.query('ROLLBACK');
    } finally { await appConn.end(); }
    const rlsCheck = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='invoice_reminders'`);
    ok('invoice_reminders : RLS activée ET forcée', rlsCheck.rows[0].relrowsecurity && rlsCheck.rows[0].relforcerowsecurity);

    // ── 8. paiement soldant ─────────────────────────────────────────────────
    console.log('\n8) Encaissement d’une facture overdue');
    await api('POST', '/billing/cash-register/open', tokenA, { site_id: A.site, opening_balance: 0 });
    const pay = await api('POST', '/billing/payments/cash', tokenA, { invoice_id: invLate.id, amount: 12000 });
    ok('Paiement 12000 sur facture overdue → paid', pay.status === 201 && pay.body.invoice.status === 'paid', JSON.stringify(pay.body).slice(0, 120));
    aged = await api('GET', '/billing/invoices/aged-balance', tokenA);
    ok('Facture payée sortie de la balance ; overdue_total = 5000', !aged.body.invoices.some((i) => i.id === invLate.id) && Number(aged.body.totals.overdue_total) === 5000, JSON.stringify(aged.body.totals));
    const remPaid = await api('POST', `/billing/invoices/${invLate.id}/reminders`, tokenA, { level: 1, channel: 'manual', notes: 'x' });
    ok('Relance sur facture payée → 422 INVOICE_NOT_RECEIVABLE', remPaid.status === 422 && remPaid.body.code === 'INVOICE_NOT_RECEIVABLE');
    ok('Historique des relances conservé après paiement (3 lignes)', (await db.query(`SELECT count(*)::int AS n FROM invoice_reminders WHERE invoice_id=$1`, [invLate.id])).rows[0].n === 3);
    const audit = await db.query(`SELECT resource_type, action, count(*)::int AS n FROM audit_logs WHERE organization_id=$1 AND ((resource_type='invoice' AND resource_label='invoice.sent') OR resource_type='invoice_reminder') GROUP BY 1,2 ORDER BY 1`, [A.org]);
    ok('Audit : 3 émissions (invoice/update) et 3 relances (invoice_reminder/create)', JSON.stringify(audit.rows) === JSON.stringify([{ resource_type: 'invoice', action: 'update', n: 3 }, { resource_type: 'invoice_reminder', action: 'create', n: 3 }]), JSON.stringify(audit.rows));
  } finally {
    try {
      // Le cycle financier (invoices/payments) est immuable en base (C04) : comme
      // phase8, seules les données non financières sont retirées ; la suite
      // suivante repart d'un --reset.
      // Jobs PDF laissés pending (aucun worker ici) : retirés pour ne pas polluer les suites sans reset (phase44).
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN ${cleanupOrgs} AND status='pending'`);
      for (const t of ['invoice_reminders', 'audit_logs', 'data_access_logs', 'sessions', 'devices']) {
        await db.query(`DELETE FROM ${t} WHERE organization_id IN ${cleanupOrgs}`);
      }
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%')`);
    } catch (e) { console.error('Nettoyage phase57 partiel :', e.message); }
    await app.close();
    await db.end();
  }
  if (failures.length) {
    console.error(`\nÉCHEC Phase 57 : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 57 validée : impayés & relances (P2-3) sur PostgreSQL réel NOBYPASSRLS + SMTP réel.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
