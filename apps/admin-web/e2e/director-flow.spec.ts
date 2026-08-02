import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E Phase 9 — parcours directeur :
 *   1. connexion ;
 *   2. pointer la section (arrivée de l'enfant e2e depuis /attendance) ;
 *   3. générer une facture mensuelle depuis /billing.
 *
 * Données : tests/tenant-isolation/seed-e2e.mjs (e2e.director@test.dz,
 * enfant « E2E Child », contrat 12000 DZD). L'API doit tourner sur le port
 * 3000 (webServer de playwright.config.ts) et le frontend sur 4000.
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.access_token as string;
}

test('parcours directeur : connexion → pointage → facture', async ({ page, request }) => {
  const token = await apiLogin(request);

  // ── Connexion (UI) ───────────────────────────────────────────────────────
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Bienvenue')).toBeVisible();

  // ── Pointer la section (arrivée de l'enfant e2e) ─────────────────────────
  await page.getByRole('link', { name: 'Présences' }).click();
  await expect(page).toHaveURL(/\/attendance/);
  const row = page.getByRole('row', { name: /E2E Child/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Arrivée' }).click();
  await expect(page.getByText('Arrivée enregistrée')).toBeVisible();

  // ── Générer une facture mensuelle ────────────────────────────────────────
  const contracts = await request.get('/api/v1/billing/contracts', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(contracts.ok()).toBeTruthy();
  const contractId = ((await contracts.json()) as Array<{ id: string }>)[0].id;

  await page.getByRole('link', { name: 'Facturation' }).click();
  await expect(page).toHaveURL(/\/billing/);
  await page.getByRole('button', { name: 'Factures' }).click();
  await page.getByLabel('Contrat (UUID)').fill(contractId);
  await page.getByLabel('Année').fill(String(new Date().getFullYear()));
  await page.getByLabel('Mois').fill('1');
  await page.getByLabel('Échéance').fill(`${new Date().getFullYear()}-01-31`);
  await page.getByRole('button', { name: 'Générer la facture' }).click();
  await expect(page.getByText('Facture générée')).toBeVisible();
});
