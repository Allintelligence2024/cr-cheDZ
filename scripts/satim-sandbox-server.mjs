#!/usr/bin/env node
/**
 * P1-1 — Simulateur local de la passerelle SATIM (même contrat que
 * payment-provider.service.ts) pour les environnements sans compte marchand :
 *   POST /payment/init  : vérifie x-satim-signature (HMAC-SHA256 hex de
 *                         merchant_id|amount|currency|invoice_id|reference),
 *                         répond { redirect_url, transaction_id } ;
 *   GET  /pay?t=<tx>    : page de « paiement » qui, au clic, déclenche le
 *                         rappel webhook signé vers l'API (PAYMENT_WEBHOOK_SECRET)
 *                         — comme le ferait le PSP après saisie de la carte.
 * Usage : SATIM_SECRET=... PAYMENT_WEBHOOK_SECRET=... API_URL=http://localhost:3000 \
 *         node scripts/satim-sandbox-server.mjs   (port SATIM_SANDBOX_PORT, défaut 4545)
 * Ce simulateur n'est PAS la sandbox SATIM officielle : il sert à prouver le
 * parcours technique complet en attendant l'enrôlement marchand (docs/paiement/SATIM.md).
 */
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';

const secret = process.env.SATIM_SECRET; const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET; const apiUrl = process.env.API_URL;
if (!secret || !webhookSecret || !apiUrl) { console.error('SATIM_SECRET, PAYMENT_WEBHOOK_SECRET, API_URL requis'); process.exit(2); }
const port = Number(process.env.SATIM_SANDBOX_PORT ?? 4545);
const tx = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && url.pathname === '/payment/init') {
    let body = ''; for await (const c of req) body += c;
    const p = JSON.parse(body);
    const canonical = [p.merchant_id, p.amount, p.currency, p.invoice_id, p.reference].join('|');
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    if (req.headers['x-satim-signature'] !== expected) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'BAD_SIGNATURE' })); }
    const id = `TX-SBX-${randomUUID().slice(0, 8)}`;
    tx.set(id, p);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ redirect_url: `http://127.0.0.1:${port}/pay?t=${id}`, transaction_id: id }));
  }
  if (req.method === 'GET' && url.pathname === '/pay') {
    const p = tx.get(url.searchParams.get('t'));
    if (!p) { res.writeHead(404); return res.end('unknown transaction'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<h1>Sandbox SATIM (simulateur)</h1><p>Facture ${p.invoice_id} — ${p.amount} ${p.currency}</p>
      <form method="post" action="/confirm?t=${url.searchParams.get('t')}"><button>Payer</button></form>`);
  }
  if (req.method === 'POST' && url.pathname === '/confirm') {
    const id = url.searchParams.get('t'); const p = tx.get(id);
    if (!p) { res.writeHead(404); return res.end('unknown transaction'); }
    const body = JSON.stringify({ external_reference: p.reference, invoice_id: p.invoice_id, amount: Number(p.amount), gateway: 'cib' });
    const sig = createHmac('sha256', webhookSecret).update(body).digest('hex');
    const r = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v1/billing/webhooks/payment`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment-signature': sig }, body });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<p>Webhook → API : HTTP ${r.status}</p><pre>${(await r.text()).slice(0, 500)}</pre>`);
  }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => console.log(`[satim-sandbox] simulateur sur http://127.0.0.1:${port} (init + page de paiement + webhook)`));
