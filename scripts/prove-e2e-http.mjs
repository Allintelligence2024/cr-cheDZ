#!/usr/bin/env node
/**
 * Rejoue les contrats API que couvrent les specs billing/payroll Playwright,
 * sans navigateur. Complément de preuve (pas remplacement des e2e UI) pour les
 * environnements où Chromium ne peut pas être installé.
 *
 * PRÉREQUIS — tous sont obligatoires :
 *   1. PostgreSQL 18 JETABLE, migré + seedé par :
 *        node scripts/migrate.mjs --reset
 *        node scripts/migrate.mjs
 *        node scripts/seed.mjs
 *        node tests/tenant-isolation/seed-e2e.mjs
 *   2. API réelle compilée et démarrée sur `E2E_API_BASE_URL` (défaut :
 *      http://127.0.0.1:3000/api/v1), même `DATABASE_URL` que ci-dessus.
 *   3. Ne pas lancer sur prod ni staging partagé : les insertions financières
 *      sont protégées contre DELETE et le script ne les nettoie pas.
 *
 * Le script réserve les factures des mois 8–11 de l'année courante et la paie
 * du mois 1. Il refuse de démarrer si ces périodes existent déjà, au lieu de
 * réutiliser silencieusement une donnée possiblement finalisée.
 *
 * Usage : node scripts/prove-e2e-http.mjs
 * Sortie : 0 = 22 assertions API vérifiées ; 1 = prérequis ou assertion en échec.
 */
const BASE = (process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';
const YEAR = new Date().getFullYear();
const FUTURE_DUE = `${YEAR + 1}-12-31`;
const PAST_DUE = `${YEAR - 1}-01-15`;
const RESERVED_INVOICE_MONTHS = [8, 9, 10, 11];

let token = '';
let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failed++;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  return { status: response.status, body: json };
}

function requireId(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} : identifiant absent ; la suite ne peut pas continuer.`);
  }
  return value;
}

async function invoiceStatus(id) {
  const response = await call('GET', `/billing/invoices/${id}`);
  return { ...response, statusValue: response.body?.status };
}

try {
  console.log(`API : ${BASE}`);
  console.log(`Fixture : ${EMAIL}; année ${YEAR}; PostgreSQL jetable exigé.`);

  console.log('\nPRÉREQUIS — comptes/périodes vierges');
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || typeof login.body?.access_token !== 'string') {
    throw new Error(
      `login ${login.status} : ${login.body?.code ?? login.body?.message_fr ?? 'API indisponible ou seed e2e absent'}`,
    );
  }
  token = login.body.access_token;
  assert('login du directeur synthétique : 200 + jeton', login.status === 200 && token.length > 0);

  const contractResponse = await call('GET', '/billing/contracts');
  const contracts = contractResponse.body;
  if (contractResponse.status !== 200 || !Array.isArray(contracts) || contracts.length === 0) {
    throw new Error('Aucun contrat du seed e2e ; rejouer seed-e2e.mjs sur cette base jetable.');
  }
  const contractId = requireId(contracts[0].id, 'Contrat e2e');
  assert('contrat synthétique présent', contractResponse.status === 200 && contracts.length > 0);

  const invoicesResponse = await call('GET', '/billing/invoices');
  if (invoicesResponse.status !== 200 || !Array.isArray(invoicesResponse.body)) {
    throw new Error('GET /billing/invoices indisponible ; vérifier l’API réelle.');
  }
  const dirtyInvoiceMonths = invoicesResponse.body
    .filter((invoice) => invoice.period_year === YEAR && RESERVED_INVOICE_MONTHS.includes(invoice.period_month))
    .map((invoice) => invoice.period_month);
  const payrollResponse = await call('GET', '/payroll/runs');
  if (payrollResponse.status !== 200 || !Array.isArray(payrollResponse.body)) {
    throw new Error('GET /payroll/runs indisponible ; vérifier l’API réelle.');
  }
  if (dirtyInvoiceMonths.length > 0 || payrollResponse.body.some((run) => run.period_year === YEAR && run.period_month === 1)) {
    throw new Error(
      `Périodes réservées déjà occupées (factures ${dirtyInvoiceMonths.join(', ') || '—'}; ` +
        `paie mois 1 ${payrollResponse.body.some((run) => run.period_year === YEAR && run.period_month === 1) ? 'oui' : 'non'}). ` +
        'Réinitialiser une base jetable ; ce script ne réutilise ni ne supprime de données financières.',
    );
  }

  console.log('\nBILLING — création et envoi');
  const createdInvoice = await call('POST', '/billing/invoices/generate', {
    contract_id: contractId,
    period_year: YEAR,
    period_month: 8,
    due_date: FUTURE_DUE,
  });
  const invoice8 = requireId(createdInvoice.body?.id, 'Facture mois 8');
  assert('génération de la facture réservée au scénario UI : 201 + draft', createdInvoice.status === 201 && createdInvoice.body.status === 'draft');
  const sent8 = await call('POST', `/billing/invoices/${invoice8}/send`, {});
  assert('émission : 200 + sent', sent8.status === 200 && sent8.body.status === 'sent');

  console.log('\nBILLING — paiement partiel');
  const createdPartial = await call('POST', '/billing/invoices/generate', {
    contract_id: contractId,
    period_year: YEAR,
    period_month: 9,
    due_date: FUTURE_DUE,
  });
  const invoice9 = requireId(createdPartial.body?.id, 'Facture mois 9');
  const total = Number(createdPartial.body.total_amount);
  assert('génération de la facture à encaisser : 201 + draft', createdPartial.status === 201 && createdPartial.body.status === 'draft');
  const sent9 = await call('POST', `/billing/invoices/${invoice9}/send`, {});
  assert('émission avant encaissement : 200 + sent', sent9.status === 200 && sent9.body.status === 'sent');
  const partialAmount = Math.max(1, Math.floor(total / 3));
  const payment = await call('POST', '/billing/payments/cash', { invoice_id: invoice9, amount: partialAmount });
  assert('encaissement partiel : 201', payment.status === 201);
  const afterPayment = await invoiceStatus(invoice9);
  assert('statut partially_paid et solde exact',
    afterPayment.status === 200 && afterPayment.statusValue === 'partially_paid' &&
      Number(afterPayment.body.paid_amount) === partialAmount &&
      Math.abs(Number(afterPayment.body.balance) - (total - partialAmount)) < 0.01,
    `${afterPayment.body.paid_amount ?? '?'} payé / solde ${afterPayment.body.balance ?? '?'}`);

  console.log('\nBILLING — bascule overdue à la lecture');
  const createdOverdue = await call('POST', '/billing/invoices/generate', {
    contract_id: contractId,
    period_year: YEAR,
    period_month: 10,
    due_date: PAST_DUE,
  });
  const invoice10 = requireId(createdOverdue.body?.id, 'Facture mois 10');
  assert('génération échéance passée : 201 + draft', createdOverdue.status === 201 && createdOverdue.body.status === 'draft');
  const sent10 = await call('POST', `/billing/invoices/${invoice10}/send`, {});
  assert('émission de la facture échue : 200 + sent', sent10.status === 200 && sent10.body.status === 'sent');
  const beforeAged = await invoiceStatus(invoice10);
  assert('avant aged-balance, la facture échue reste sent', beforeAged.status === 200 && beforeAged.statusValue === 'sent');
  const aged = await call('GET', '/billing/invoices/aged-balance');
  assert('lecture aged-balance : 200', aged.status === 200);
  const afterAged = await invoiceStatus(invoice10);
  assert('après aged-balance : overdue', afterAged.status === 200 && afterAged.statusValue === 'overdue');

  console.log('\nBILLING — refus des opérations invalides');
  const createdImmutable = await call('POST', '/billing/invoices/generate', {
    contract_id: contractId,
    period_year: YEAR,
    period_month: 11,
    due_date: FUTURE_DUE,
  });
  const invoice11 = requireId(createdImmutable.body?.id, 'Facture mois 11');
  assert('génération de la facture à verrouiller : 201 + draft', createdImmutable.status === 201 && createdImmutable.body.status === 'draft');
  const sent11 = await call('POST', `/billing/invoices/${invoice11}/send`, {});
  assert('premier envoi : 200 + sent', sent11.status === 200 && sent11.body.status === 'sent');
  const secondSend = await call('POST', `/billing/invoices/${invoice11}/send`, {});
  assert('second envoi refusé : 409 INVOICE_ALREADY_SENT',
    secondSend.status === 409 && secondSend.body.code === 'INVOICE_ALREADY_SENT');
  const overpayment = await call('POST', '/billing/payments/cash', {
    invoice_id: invoice11,
    amount: 999_999_999,
  });
  assert('surpaiement refusé : 422 PAYMENT_EXCEEDS_BALANCE',
    overpayment.status === 422 && overpayment.body.code === 'PAYMENT_EXCEEDS_BALANCE');

  console.log('\nPAYROLL — génération, édition et finalisation');
  const payroll = await call('POST', '/payroll/generate', { period_year: YEAR, period_month: 1 });
  const runId = requireId(payroll.body?.id, 'Run de paie mois 1');
  assert('génération paie : 201 + draft', payroll.status === 201 && payroll.body.status === 'draft');
  const runDetail = await call('GET', `/payroll/runs/${runId}`);
  const entryId = requireId(runDetail.body?.entries?.[0]?.id, 'Bulletin de paie');
  assert('seed avec employé rémunéré', runDetail.status === 200 &&
    runDetail.body.status === 'draft' && runDetail.body.entries.length > 0 &&
    Number(runDetail.body.entries[0].gross_amount) > 0,
    `bulletins=${runDetail.body.entries?.length ?? 0}, brut=${runDetail.body.entries?.[0]?.gross_amount ?? '?'}`);
  const lineBefore = await call('POST', `/payroll/entries/${entryId}/lines`, {
    lines: [{ line_type: 'bonus', label_fr: 'Prime e2e', amount: 5000 }],
  });
  assert('ajout de ligne avant finalisation : 201', lineBefore.status === 201);
  const finalized = await call('POST', `/payroll/runs/${runId}/finalize`, {});
  const finalizedDetail = await call('GET', `/payroll/runs/${runId}`);
  assert('finalisation : statut finalized', finalized.status < 300 && finalizedDetail.body.status === 'finalized');
  const lineAfter = await call('POST', `/payroll/entries/${entryId}/lines`, {
    lines: [{ line_type: 'bonus', label_fr: 'Prime après finalisation', amount: 1000 }],
  });
  assert('édition post-finalisation refusée : 422 PAYROLL_FINALIZED',
    lineAfter.status === 422 && lineAfter.body.code === 'PAYROLL_FINALIZED',
    lineAfter.body.message_fr ?? '');

  console.log(`\n${'─'.repeat(64)}\n${failed === 0 ? '✓' : '✗'} ${passed}/22 assertions API réussies, ${failed} échec(s)`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.error(`\n✗ Preuve API interrompue : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
