import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E S1 (remédiation 2026-09-21, Phase 4) — payroll : run → finalize →
 * blocage post-finalisation (R15).
 *
 * Cible : directeur de crèche pilote.
 * Scénario :
 *   1. Génération d'un run de paie → 200, statuts calculés
 *   2. Édition d'une ligne avant finalisation → OK
 *   3. Finalisation du run → badge « Finalisé » + bouton désactivé
 *   4. Édition d'une ligne APRÈS finalisation → 422 PAYROLL_FINALIZED
 *      (le trigger migration 072 refuse l'UPDATE ; cf. R15, R19 P3 lot)
 */
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

test.describe('payroll — run → finalize → blocage R15', () => {
  let token: string;
  let staffUserId: string;
  let runId: string;
  let entryId: string;

  test.beforeAll(async ({ request }) => {
    token = await apiLogin(request);

    const userRes = await request.get('/api/v1/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    const me = await userRes.json();
    staffUserId = me.id;

    const staffRes = await request.post('/api/v1/staff', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        user_id: staffUserId,
        qualification: 'educator_qualified',
        hire_date: '2025-01-01',
        base_salary: 50000,
      },
    });
    expect(staffRes.ok()).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Bienvenue')).toBeVisible();
  });

  test('génération d\'un run + édition avant finalisation', async ({ request }) => {
    const generateRes = await request.post('/api/v1/payroll/generate', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
      },
    });
    expect(generateRes.ok()).toBeTruthy();
    const run = await generateRes.json();
    runId = run.id;

    const detailRes = await request.get(`/api/v1/payroll/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    expect(detail.entries.length).toBeGreaterThan(0);
    entryId = detail.entries[0].id;

    const lineRes = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        lines: [{ line_type: 'bonus', label_fr: 'Prime test', amount: 5000 }],
      },
    });
    expect(lineRes.ok()).toBeTruthy();
  });

  test('finalisation → badge + bouton désactivé', async ({ page }) => {
    expect(runId).toBeTruthy();

    await page.goto('/payroll');
    await expect(page.getByText('Paie')).toBeVisible();

    const runRow = page.getByRole('row').filter({ hasText: new Date().getFullYear().toString() });
    await runRow.getByRole('button', { name: 'Détail' }).click();

    await page.getByRole('button', { name: 'Finaliser' }).click();
    await expect(page.getByText('Paie finalisée (immuable)')).toBeVisible();

    const addLineButtons = page.getByRole('button', { name: 'Ajouter une ligne' });
    await expect(addLineButtons).toHaveCount(0);
  });

  test('édition post-finalisation refusée (R15)', async ({ request }) => {
    expect(entryId).toBeTruthy();

    const lineRes = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        lines: [{ line_type: 'bonus', label_fr: 'Prime après finalisation', amount: 1000 }],
      },
    });
    expect(lineRes.status()).toBe(422);
    const body = await lineRes.json();
    expect(body.code).toBe('PAYROLL_FINALIZED');
  });
});
