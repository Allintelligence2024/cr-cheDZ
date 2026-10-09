import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

/**
 * UI E2E lot 5 — le parcours director est exercé dans Chromium contre l'API
 * et PostgreSQL du job CI. L'enfant et son média sont synthétiques, uniques à
 * l'essai ; l'endpoint réel doit remonter la clé dont la purge S3 échoue.
 *
 * Compte : le rôle directeur est REFUSÉ par @Permissions('privacy:manage')
 * (remédiation 2.1/2.2 — séparation DPO de la loi 25-11 : le seed 003
 * attribue privacy:manage au dpo, jamais au director). On utilise donc le
 * compte DPO créé par seed-e2e.mjs. La recherche d'enfant et l'anonymisation
 * sont des actions privacy:manage ; les autres parcours e2e (director-flow)
 * utilisent le compte director pour les actions métier.
 */
const EMAIL = 'e2e.dpo@test.dz';
const PASSWORD = 'Password123!';

async function loginUi(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Bienvenue')).toBeVisible();
}

async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { access_token: string }).access_token;
}

test('director : recherche un enfant sorti, confirme l’action et voit son résultat', async ({ page, request }) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const site = await db.query(
      `SELECT s.id AS site_id, s.organization_id, u.id AS actor_id
         FROM sites s
         JOIN organizations o ON o.id = s.organization_id
         JOIN users u ON u.email = $2
        WHERE o.slug = $1
        LIMIT 1`,
      ['e2e-org', EMAIL],
    );
    expect(site.rowCount, 'seed-e2e doit fournir un site').toBe(1);

    const searchName = `E2EAnon${randomUUID().slice(0, 8)}`;
    const token = await apiLogin(request);
    const created = await request.post('/api/v1/children', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        site_id: site.rows[0].site_id,
        first_name_fr: searchName,
        last_name_fr: 'Test',
        // Migration remédiation : AGE_CRECHE_OUT_OF_RANGE (409) bloque à la
        // saisie les enfants hors 3 mois–3 ans (décret 19-253). Un enfant
        // « sorti » a par construction DEPASSÉ l'âge crèche, mais le contrôle
        // s'applique aussi à la création synthétique de l'e2e — on prend donc
        // une date dans la tranche (un enfant de ~2,5 ans, parti par déménagement)
        // pour que le dossier de test passe la garde et reste anonymisable.
        date_of_birth: '2024-03-15',
        status: 'departed',
      },
    });
    expect(created.status(), 'l’API doit créer le dossier synthétique sorti').toBe(201);
    const { id: childId, reference_number: referenceNumber } = await created.json() as { id: string; reference_number: string };
    const storageKey = `${site.rows[0].organization_id}/photo/e2e-anonymize-${randomUUID()}.jpg`;
    await db.query(
      `INSERT INTO media_assets (organization_id, child_id, uploaded_by, media_type, storage_key, mime_type)
       VALUES ($1, $2, $3, 'photo', $4, 'image/jpeg')`,
      [site.rows[0].organization_id, childId, site.rows[0].actor_id, storageKey],
    );

    await loginUi(page);
    await page.getByRole('link', { name: 'Vie privée' }).click();
    await expect(page).toHaveURL(/\/privacy/);
    await page.getByRole('button', { name: 'Anonymisation' }).click();
    await expect(page.getByRole('heading', { name: 'Anonymiser un enfant sorti' })).toBeVisible();

    const searchRequest = page.waitForRequest((httpRequest) =>
      httpRequest.method() === 'GET' && new URL(httpRequest.url()).pathname === '/api/v1/children',
    );
    await page.getByLabel('Nom, prénom ou référence de l’enfant').fill(searchName);
    await page.getByRole('button', { name: 'Rechercher les enfants sortis' }).click();
    const childrenRequest = await searchRequest;
    const query = new URL(childrenRequest.url()).searchParams;
    expect(query.get('status')).toBe('departed');
    expect(query.get('search')).toBe(searchName);
    expect(query.get('limit')).toBe('100');

    const childRow = page.getByRole('row').filter({ hasText: searchName });
    await expect(childRow).toContainText(referenceNumber);
    await childRow.getByRole('button', { name: 'Sélectionner' }).click();
    await expect(page.getByRole('heading', { name: 'Dossier sélectionné' })).toBeVisible();

    const submit = page.getByRole('button', { name: 'Confirmer et anonymiser' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Motif de l’anonymisation').fill('  Demande de test E2E  ');
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();

    const anonymizeRequest = page.waitForRequest((candidate) =>
      candidate.method() === 'POST' && new URL(candidate.url()).pathname === `/api/v1/privacy/children/${childId}/anonymize`,
    );
    await submit.click();
    const post = await anonymizeRequest;
    expect(post.postDataJSON()).toEqual({ reason: 'Demande de test E2E' });
    await expect(page.getByText('Anonymisation effectuée.')).toBeVisible();
    await expect(page.getByText('Médias masqués: 1')).toBeVisible();
    await expect(page.getByText('Objets supprimés du stockage: 0')).toBeVisible();
    await expect(page.getByText('Échecs de purge: 1')).toBeVisible();
    await expect(page.getByText(storageKey)).toBeVisible();
    await expect(page.getByText('Purge à reprendre manuellement')).toBeVisible();

    const persisted = await db.query('SELECT first_name_fr FROM children WHERE id = $1', [childId]);
    expect(persisted.rows[0]?.first_name_fr).toMatch(/^Anonyme-[0-9a-f]{8}$/i);
  } finally {
    await db.end();
  }
});
