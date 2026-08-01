import { expect, test } from '@playwright/test';

/**
 * E2E minimal — Phase 3 : login + accès au tableau de bord.
 * Le compte de test est créé par le script de préparation CI
 * (tests/tenant-isolation/seed-e2e.mjs) : e2e.director@test.dz / Password123!
 */
test('connexion directeur → tableau de bord', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e.director@test.dz');
  await page.getByLabel('Mot de passe').fill('Password123!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Bienvenue')).toBeVisible();
});

test('mauvais mot de passe → message d’erreur', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e.director@test.dz');
  await page.getByLabel('Mot de passe').fill('WrongPassword1!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Email ou mot de passe incorrect')).toBeVisible();
});
