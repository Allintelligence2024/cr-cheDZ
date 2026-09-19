import { expect, test } from '@playwright/test';

/**
 * E2E G2 — export Excel de bout en bout avec le VRAI worker :
 * demande depuis l'UI → job en base → claim par le worker (webServer #3) →
 * ligne DONE → clic « Télécharger » → fichier reçu par le navigateur.
 *
 * Prérequis : worker compilé (`npm run build --workspace @creche/worker`) et
 * lancé par playwright.config.ts ; STORAGE_BACKEND=local. Si le worker ne
 * tourne pas, l'export reste `pending` et le test échoue au timeout — un
 * rouge honnête, pas un faux vert.
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

test('export présences : demande UI → worker réel → téléchargement navigateur', async ({ page }) => {
  // Connexion via l'UI.
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Bienvenue')).toBeVisible();

  const today = new Date().toISOString().slice(0, 10); // période par défaut de la page

  await page.goto('/exports');
  await expect(page.getByText('Exports Excel')).toBeVisible();

  // Demande d'un export de présences (période par défaut : aujourd'hui).
  await page.getByRole('button', { name: "Demander l'export" }).click();
  await expect(page.getByText(/Export demandé/)).toBeVisible();

  // La ligne passe DONE une fois le job traité par le worker (~2 s de poll).
  const row = page
    .getByRole('row')
    .filter({ hasText: 'Présences' })
    .filter({ hasText: today })
    .filter({ hasText: /DONE/ });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Téléchargement via le navigateur : un vrai fichier doit arriver.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Télécharger' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^export-.*\.xlsx$/);
});
