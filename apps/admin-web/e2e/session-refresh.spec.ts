import { expect, test } from '@playwright/test';

/**
 * E2E G2 — persistance de session et rafraîchissement de jeton (A2/A3) :
 * un access token expiré/corrompu ne doit PAS éjecter l'utilisateur vers
 * /login tant que le refresh token est valide : le client renouvelle
 * silencieusement via /auth/refresh puis rejoue la requête.
 *
 * Méthode : connexion UI réelle, puis l'access token en localStorage est
 * remplacé par une valeur invalide (simulation d'expiration) et la page est
 * rechargée — le tableau de bord doit s'afficher quand même.
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

test('session : access token expiré → refresh silencieux → tableau de bord', async ({ page }) => {
  // Connexion réelle via l'UI.
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Bienvenue')).toBeVisible();

  // Simule un access token expiré : le refresh token reste valide.
  await page.evaluate(() => {
    localStorage.setItem('creche_access_token', 'expired.invalid.token');
  });
  await page.reload();

  // Sans refresh fonctionnel, l'app renverrait vers /login.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Bienvenue')).toBeVisible();
});
