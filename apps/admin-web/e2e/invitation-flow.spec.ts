import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E G2 — parcours d'invitation complet (remédiation audits combinés) :
 *   1. le directeur invite un membre (API réelle) ;
 *   2. l'invité ouvre le lien d'activation (/accept-invitation?token=…) ;
 *   3. il définit son identité + mot de passe et arrive sur le tableau de bord
 *      (régression A1 : plus de redirection silencieuse vers /login) ;
 *   4. le nouveau compte peut se connecter de façon autonome.
 *
 * Prérequis : l'API webServer tourne avec NODE_ENV=development +
 * EMAIL_PROVIDER=none — le jeton d'invitation est alors remis dans la réponse
 * (transport email réel non livré ; hors development l'API échoue en 503,
 * comportement vérifié par les suites d'isolation).
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.access_token as string;
}

test('invitation : création → activation via lien → compte utilisable', async ({ page, request }) => {
  const token = await apiLogin(request);

  // ── 1. Le directeur invite un nouveau membre (API réelle) ────────────────
  const invitedEmail = `e2e.invited-${Date.now()}@test.dz`;
  const inviteRes = await request.post('/api/v1/invitations', {
    headers: { authorization: `Bearer ${token}` },
    data: { email: invitedEmail, role_slug: 'educator' },
  });
  expect(inviteRes.ok()).toBeTruthy();
  const invite = (await inviteRes.json()) as { status?: string; invitation_token?: string };
  expect(invite.status).toBe('invited');
  expect(typeof invite.invitation_token).toBe('string'); // remis uniquement en development

  // ── 2-3. Activation via le lien (parcours navigateur, sans session) ──────
  await page.goto(`/accept-invitation?token=${invite.invitation_token}`);
  await expect(page.getByText("Acceptation d'invitation")).toBeVisible();
  await page.getByLabel('Prénom').fill('E2E');
  await page.getByLabel('Nom').fill('Invitée');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Activer mon compte' }).click();

  // Régression A1 : l'utilisateur arrive sur le tableau de bord, PAS /login.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Bienvenue')).toBeVisible();

  // ── 4. Le compte activé se connecte de façon autonome ────────────────────
  const login = await request.post('/api/v1/auth/login', {
    data: { email: invitedEmail, password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
});
