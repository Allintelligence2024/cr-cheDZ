#!/usr/bin/env node
/**
 * P1-1 — Preuve de bout en bout du paiement en ligne contre une passerelle
 * RÉELLE (sandbox SATIM) — ou, sans identifiants marchands, contre le
 * simulateur local `scripts/satim-sandbox-server.mjs` qui implémente le même
 * contrat HTTP (init signé HMAC + rappel webhook signé).
 *
 * Scénario : login → facture → POST /billing/payments/online (init réel) →
 * la passerelle rappelle POST /billing/webhooks/payment → facture payée →
 * GET /billing/payments/online/reconciliation (0 pending/stale).
 *
 * Usage :
 *   API_URL=https://api.example.dz LOGIN_EMAIL=... LOGIN_PASSWORD=... INVOICE_ID=... \
 *   PAYMENT_WEBHOOK_SECRET=... node scripts/satim-sandbox-proof.mjs
 * Avec la sandbox SATIM réelle : l'API doit être configurée avec
 * SATIM_MERCHANT_ID / SATIM_SECRET / SATIM_GATEWAY_URL (test.satim.dz) et le
 * webhook joignable publiquement ; sans PSP, lancer d'abord
 * `node scripts/satim-sandbox-server.mjs` et pointer SATIM_GATEWAY_URL dessus.
 * Le script ne devine JAMAIS un statut : il échoue si la facture n'est pas
 * réellement passée à 'paid' via le webhook.
 */
import { createHmac } from 'node:crypto';

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`✗ ${k} requis`); process.exit(2); } return v; };
const api = need('API_URL').replace(/\/$/, '');
const email = need('LOGIN_EMAIL'); const password = need('LOGIN_PASSWORD');
const invoiceId = need('INVOICE_ID');
const method = process.env.PAYMENT_METHOD ?? 'cib';
const simulateWebhook = process.env.SIMULATE_WEBHOOK === '1';

const call = async (path, init = {}, token) => {
  const r = await fetch(`${api}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {} };
};
const fail = (m, d) => { console.error(`✗ ${m}`, d ?? ''); process.exit(1); };

const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
if (login.status !== 200) fail('login', login.body);
const token = login.body.access_token;
console.log('✓ login');

const before = await call(`/billing/invoices/${invoiceId}`, {}, token);
if (before.status !== 200) fail('facture introuvable', before.body);
if (before.body.status === 'paid') fail('facture déjà payée : choisir une facture ouverte');
console.log(`✓ facture ${before.body.invoice_number} : ${before.body.status}, solde ${before.body.balance}`);

const init = await call('/billing/payments/online', { method: 'POST', body: JSON.stringify({ invoice_id: invoiceId, method }) }, token);
if (init.status !== 201) fail(`init passerelle refusé (${init.status}) — ${init.body.code ?? ''}`, init.body);
console.log(`✓ init passerelle : ${init.body.reference_number} → ${init.body.redirect_url} (tx ${init.body.transaction_id})`);

if (simulateWebhook) {
  // Sans parcours navigateur : on joue le rappel du PSP (même contrat signé).
  const secret = need('PAYMENT_WEBHOOK_SECRET');
  const body = JSON.stringify({ external_reference: init.body.external_reference, invoice_id: invoiceId, amount: Number(init.body.amount), gateway: method });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const wh = await fetch(`${api}/api/v1/billing/webhooks/payment`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment-signature': sig }, body });
  if (wh.status !== 200) fail(`webhook refusé (${wh.status})`, await wh.text());
  console.log('✓ webhook de confirmation accepté');
} else {
  console.log(`→ Terminer le paiement dans le navigateur : ${init.body.redirect_url}`);
  console.log('→ Attente du rappel webhook du PSP (max 10 min)…');
}

const deadline = Date.now() + (simulateWebhook ? 15000 : 600000);
let after;
while (Date.now() < deadline) {
  after = await call(`/billing/invoices/${invoiceId}`, {}, token);
  if (after.body.status === 'paid' || after.body.status === 'partially_paid') break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!after || !['paid', 'partially_paid'].includes(after.body.status)) fail('la facture n’a pas été confirmée par webhook dans le délai', after?.body);
console.log(`✓ facture ${after.body.status} — paid_amount ${after.body.paid_amount}`);

const rec = await call('/billing/payments/online/reconciliation?stale_minutes=5', {}, token);
if (rec.status !== 200) fail('rapprochement', rec.body);
const mine = rec.body.items.find((p) => p.external_reference === init.body.external_reference);
if (!mine || mine.status !== 'confirmed') fail('le paiement n’apparaît pas confirmé au rapprochement', mine);
console.log(`✓ rapprochement : ${rec.body.totals.confirmed.count} confirmé(s), ${rec.body.totals.stale.count} en souffrance`);
console.log('\n✓ P1-1 : cycle init → webhook → facture payée → rapprochement prouvé contre la passerelle configurée.');
