import { expect, test, type APIRequestContext } from '@playwright/test';

const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.access_token as string;
}

async function getCurrentOrg(request: APIRequestContext, token: string): Promise<string> {
  const meRes = await request.get('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const me = await meRes.json();
  const orgId = me.memberships?.[0]?.organization_id;
  expect(orgId).toBeTruthy();
  return orgId as string;
}

async function getChildId(request: APIRequestContext, token: string): Promise<string> {
  const childrenRes = await request.get('/api/v1/children', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(childrenRes.ok()).toBeTruthy();
  const children = await childrenRes.json();
  const childId = children.items?.[0]?.id ?? children[0]?.id;
  expect(childId).toBeTruthy();
  return childId as string;
}

async function getContractId(request: APIRequestContext, token: string): Promise<string> {
  const contractsRes = await request.get('/api/v1/billing/contracts', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(contractsRes.ok()).toBeTruthy();
  const contracts = await contractsRes.json();
  const contract = contracts.items?.[0] ?? contracts[0];
  expect(contract).toBeTruthy();
  return contract.id as string;
}

async function findAvailablePeriod(
  request: APIRequestContext,
  token: string,
  contractId: string,
): Promise<{ year: number; month: number }> {
  const year = new Date().getFullYear();
  for (let month = 1; month <= 12; month++) {
    const res = await request.post('/api/v1/billing/invoices/generate', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        contract_id: contractId,
        period_year: year,
        period_month: month,
        due_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
    });
    if (res.ok()) {
      const invoice = await res.json();
      return { year, month, invoiceId: invoice.id as string };
    }
    const body = await res.json();
    if (body.code !== 'INVOICE_ALREADY_EXISTS') {
      throw new Error(`Unexpected error: ${JSON.stringify(body)}`);
    }
  }
  throw new Error('No available period found for invoice generation');
}

test.describe('billing — flux facture → encaissement → overdue', () => {
  let token: string;
  let invoiceId: string;

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Bienvenue')).toBeVisible();
  });

  test('création facture', async ({ request }) => {
    const contractId = await getContractId(request, token);
    const { invoiceId: newInvoiceId } = await findAvailablePeriod(request, token, contractId);
    invoiceId = newInvoiceId;
  });

  test('encaissement partiel → statut partially_paid', async ({ request, page }) => {
    expect(invoiceId).toBeTruthy();

    const invoiceRes = await request.get(`/api/v1/billing/invoices/${invoiceId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invoiceRes.ok()).toBeTruthy();
    const invoice = await invoiceRes.json();
    const total = Number(invoice.total_amount);
    const partialAmount = Math.round(total / 2);

    await page.goto('/billing');
    await page.getByRole('button', { name: 'Paiements' }).click();

    await page.getByLabel('Facture (UUID)').fill(invoiceId);
    await page.getByLabel('Montant (DZD)').fill(String(partialAmount));
    await page.getByRole('button', { name: 'Paiement espèces' }).click();
    await expect(page.getByText('Paiement enregistré')).toBeVisible();

    await page.goto('/billing');
    await page.getByRole('button', { name: 'Factures' }).click();
    await expect(page.getByText('Partiellement payée').first()).toBeVisible();
  });

  test('partially_paid non éditable (R19)', async ({ page }) => {
    await page.goto('/billing');
    await page.getByRole('button', { name: 'Factures' }).click();
    await expect(page.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);
  });

  test('facture overdue (R15)', async ({ request, page }) => {
    expect(invoiceId).toBeTruthy();

    const overdueRes = await request.post(`/api/v1/billing/invoices/${invoiceId}/mark-overdue`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(overdueRes.ok()).toBeTruthy();

    await page.goto('/billing');
    await page.getByRole('button', { name: 'Factures' }).click();
    await expect(page.getByText('En retard')).toBeVisible();
  });
});
