import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E lot 2 (remédiation 2026-09-27) — flux de facturation complet.
 *
 * Compte : tests/tenant-isolation/seed-e2e.mjs — e2e.director@test.dz /
 * Password123!. L'API (3000), le worker et le frontend (4000) sont démarrés
 * par le webServer de playwright.config.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LA VERSION PRÉCÉDENTE (SQUELETTE) AFFIRMAIT À TORT
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ancien fichier décrivait un scénario qui n'existe nulle part dans le code.
 * Relevé, vérifié endpoint par endpoint avant réécriture :
 *
 *   1. « POST /billing/invoices »                 → n'existe pas. C'est
 *      POST /billing/invoices/generate (billing.controller.ts:55).
 *   2. « POST /billing/invoices/:id/mark-overdue »→ n'existe PAS DU TOUT. Il
 *      n'y a aucun endpoint de bascule : la transition est appliquée À LA
 *      LECTURE par invoices_mark_overdue($org) (migration 068), appelée par
 *      GET /billing/invoices/aged-balance et POST .../reminders uniquement.
 *      Conséquence non triviale : l'onglet « Factures » appelle
 *      GET /billing/invoices, qui NE déclenche PAS la transition — une facture
 *      échue y reste affichée « Envoyée » jusqu'à ce qu'on consulte la balance
 *      âgée. C'est ce que le test 3 vérifie nommément.
 *   3. La transition ne s'applique qu'aux statuts sent / partially_paid. Une
 *      facture restée « Brouillon » ne passera JAMAIS en retard : il faut
 *      l'émettre d'abord (POST .../send).
 *   4. Le libellé exact est « Partiellement payée » (féminin, i18n
 *      'invoice.status.partially_paid'), pas « Partiellement payé ».
 *
 * Chaque comportement ci-dessous a été prouvé par requête HTTP directe contre
 * l'API réelle avant d'être écrit en Playwright (voir §11 du plan).
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

/**
 * Statuts affichés, tels que rendus par t('invoice.status.<statut>')
 * (packages/i18n). Écrits EN CLAIR aux points d'assertion plutôt que dans une
 * table de constantes : le gardien check-e2e-skeletons.mjs ne peut vérifier
 * que des littéraux, et une faute d'accord (« Partiellement payé » au lieu de
 * « Partiellement payée ») est exactement le genre d'erreur qui fait expirer
 * une spec sans jamais rien casser à la compilation.
 */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Contrat du seed e2e (enfant « E2E Child », 12 000 DZD/mois). */
async function firstContractId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get('/api/v1/billing/contracts', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as Array<{ id: string }>)[0].id;
}

/**
 * Génère une facture. `period_month` doit être LIBRE pour ce contrat :
 * billing.service.ts refuse un doublon (contrat, année, mois) non annulé.
 */
async function generateInvoice(
  request: APIRequestContext,
  token: string,
  contractId: string,
  periodMonth: number,
  dueDate: string,
): Promise<{ id: string; total_amount: string }> {
  const year = new Date().getFullYear();
  const res = await request.post('/api/v1/billing/invoices/generate', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { contract_id: contractId, period_year: year, period_month: periodMonth, due_date: dueDate },
  });
  expect(res.status(), `generate (mois ${periodMonth})`).toBe(201);
  return (await res.json()) as { id: string; total_amount: string };
}

async function sendInvoice(request: APIRequestContext, token: string, invoiceId: string): Promise<void> {
  const res = await request.post(`/api/v1/billing/invoices/${invoiceId}/send`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
}

async function statusOf(request: APIRequestContext, token: string, invoiceId: string): Promise<string> {
  const res = await request.get(`/api/v1/billing/invoices/${invoiceId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { status: string }).status;
}

async function loginUi(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Bienvenue')).toBeVisible();
}

/** Onglet « Factures » — l'onglet par défaut de BillingPage est « Contrats ». */
async function openInvoicesTab(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Facturation' }).click();
  await expect(page).toHaveURL(/\/billing/);
  await page.getByRole('button', { name: 'Factures' }).click();
}

const rowFor = (page: import('@playwright/test').Page, invoiceNumber: string) =>
  page.locator('tr').filter({ hasText: invoiceNumber });

test.describe('billing — facture → envoi → encaissement → retard', () => {
  test('création d’une facture depuis l’UI', async ({ page, request }) => {
    const token = await apiLogin(request);
    const contractId = await firstContractId(request, token);
    // Mois 8 : distinct du parcours `director-flow.spec.ts`, qui génère le
    // mois 1. Les autres tests de cette spec prennent 9, 10, 11.
    const month = 8;

    await loginUi(page);
    await openInvoicesTab(page);

    await page.getByLabel('Contrat (UUID)').fill(contractId);
    await page.getByLabel('Année').fill(String(new Date().getFullYear()));
    await page.getByLabel('Mois').fill(String(month));
    await page.getByLabel('Échéance').fill(`${new Date().getFullYear() + 1}-12-31`);
    await page.getByRole('button', { name: 'Générer la facture' }).click();

    await expect(page.getByText('Facture générée')).toBeVisible();

    // La création est déclenchée par l'UI ; l'API sert uniquement à retrouver
    // le numéro métier renvoyé pour ce contrat/période. Le job CI repart d'une
    // base resetée : un doublon n'est pas « absorbé » par un catch, il doit
    // faire rougir le test plutôt que masquer une contamination de fixture.
    const listRes = await request.get('/api/v1/billing/invoices', {
      headers: { authorization: *** ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    // 3.2.4 : la liste est une RÉPONSE PAGINÉE { items, total, page, limit }.
    const listBody = (await listRes.json()) as { items: Array<{
      invoice_number: string;
      period_year: number;
      period_month: number;
    }> };
    const invoices = listBody.items;
    const created = invoices.find((i) => i.period_year === new Date().getFullYear() && i.period_month === month);
    expect(created, `la facture ${new Date().getFullYear()}-${month} créée par l'UI doit exister`).toBeTruthy();
    await expect(rowFor(page, created!.invoice_number)).toContainText('Brouillon');
  });

  test('envoi puis encaissement partiel → Partiellement payée', async ({ page, request }) => {
    const token = await apiLogin(request);
    const contractId = await firstContractId(request, token);
    const month = 9;
    const future = `${new Date().getFullYear() + 1}-12-31`;
    const inv = await generateInvoice(request, token, contractId, month, future);
    const invoiceId = inv.id;
    const total = Number(inv.total_amount);

    // L'émission (draft → sent) n'a PAS d'affordance dans l'UI : pas de bouton
    // « Émettre » dans BillingPage. On passe donc par l'API, comme le fait
    // director-flow.spec.ts pour la création de contrat.
    if ((await statusOf(request, token, invoiceId)) === 'draft') {
      await sendInvoice(request, token, invoiceId);
    }
    expect(await statusOf(request, token, invoiceId)).toBe('sent');

    const partiel = Math.max(1, Math.floor(total / 3));

    await loginUi(page);
    await page.getByRole('link', { name: 'Facturation' }).click();
    await page.getByRole('button', { name: 'Paiements' }).click();
    await page.getByLabel('Facture (UUID)').fill(invoiceId);
    await page.getByLabel('Montant (DZD)').fill(String(partiel));
    await page.getByRole('button', { name: 'Paiement espèces' }).click();
    await expect(page.getByText('Paiement enregistré')).toBeVisible();

    // Retour à l'onglet Factures : le statut et le solde doivent être à jour.
    await page.getByRole('button', { name: 'Factures' }).click();
    const after = (await (
      await request.get(`/api/v1/billing/invoices/${invoiceId}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { invoice_number: string; status: string; balance: string; paid_amount: string };
    expect(after.status).toBe('partially_paid');
    expect(Number(after.paid_amount)).toBe(partiel);
    expect(Number(after.balance)).toBeCloseTo(total - partiel, 2);
    await expect(rowFor(page, after.invoice_number)).toContainText('Partiellement payée');
  });

  test('échéance dépassée → bascule « En retard » À LA LECTURE de la balance âgée', async ({
    page,
    request,
  }) => {
    const token = await apiLogin(request);
    const contractId = await firstContractId(request, token);
    const month = 10;
    const past = `${new Date().getFullYear() - 1}-01-15`;
    const invoiceId = (await generateInvoice(request, token, contractId, month, past)).id;

    if ((await statusOf(request, token, invoiceId)) === 'draft') {
      await sendInvoice(request, token, invoiceId);
    }

    // ── Le point de la spec ────────────────────────────────────────────────
    // AVANT la lecture de la balance âgée, la facture échue est encore
    // « Envoyée » : la transition n'est pas un job, elle est appliquée à la
    // lecture. C'est exactement ce que l'ancienne version du fichier ignorait
    // en inventant un endpoint « mark-overdue ».
    expect(await statusOf(request, token, invoiceId)).toBe('sent');

    await loginUi(page);
    await openInvoicesTab(page);
    const number = ((await (
      await request.get(`/api/v1/billing/invoices/${invoiceId}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { invoice_number: string }).invoice_number;
    await expect(rowFor(page, number)).toContainText('Envoyée');

    const aged = await request.get('/api/v1/billing/invoices/aged-balance', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(aged.ok()).toBeTruthy();

    expect(await statusOf(request, token, invoiceId)).toBe('overdue');
    // Remonter l'onglet au lieu de recharger la page : InvoicesTab est démontée
    // puis remontée et son GET /billing/invoices relit le statut. (Le GET simple
    // ne déclenche pas lui-même la transition ; c'est le aged-balance ci-dessus.)
    await page.getByRole('button', { name: 'Contrats' }).click();
    await page.getByRole('button', { name: 'Factures' }).click();
    await expect(rowFor(page, number)).toContainText('En retard');
  });

  test('facture émise non modifiable, paiement borné au solde', async ({ page, request }) => {
    const token = await apiLogin(request);
    const contractId = await firstContractId(request, token);
    const month = 11;
    const future = `${new Date().getFullYear() + 1}-12-31`;
    const invoiceId = (await generateInvoice(request, token, contractId, month, future)).id;

    if ((await statusOf(request, token, invoiceId)) === 'draft') {
      await sendInvoice(request, token, invoiceId);
    }

    // (a) Une facture déjà émise ne peut pas être réémise : 409.
    const second = await request.post(`/api/v1/billing/invoices/${invoiceId}/send`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.status()).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe('INVOICE_ALREADY_SENT');

    // (b) Un encaissement supérieur au solde est refusé : 422.
    const over = await request.post('/api/v1/billing/payments/cash', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { invoice_id: invoiceId, amount: 999_999_999 },
    });
    expect(over.status()).toBe(422);
    expect(((await over.json()) as { code: string }).code).toBe('PAYMENT_EXCEEDS_BALANCE');

    // (c) Et l'UI n'expose aucun contrôle d'édition ni de suppression sur une
    // facture : la colonne d'actions ne contient que « PDF ». À dire
    // franchement, cette assertion est PLUS FAIBLE qu'elle n'en a l'air —
    // l'absence de bouton vaut pour toutes les factures, pas seulement pour
    // les partiellement payées. La vraie garantie (INVOICE_IMMUTABLE, trigger
    // 064) est prouvée côté API et par les suites PG, pas ici. On garde
    // l'assertion pour ce qu'elle est : un filet contre l'apparition d'un
    // contrôle d'édition non gardé.
    await loginUi(page);
    await openInvoicesTab(page);
    const number = ((await (
      await request.get(`/api/v1/billing/invoices/${invoiceId}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { invoice_number: string }).invoice_number;
    const row = rowFor(page, number);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);
  });
});
