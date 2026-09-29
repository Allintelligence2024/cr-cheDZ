import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * E2E lot 2 (remédiation 2026-09-27) — paie : génération → ligne →
 * finalisation → blocage post-finalisation.
 *
 * Compte : tests/tenant-isolation/seed-e2e.mjs — e2e.director@test.dz /
 * Password123!. Ce seed crée depuis ce lot un employé rémunéré (45 000 DZD) :
 * sans lui, POST /payroll/generate répond 422 PAYROLL_NO_STAFF (« Aucun employé
 * avec salaire de base ») et les trois tests ci-dessous ne peuvent pas
 * s'exécuter du tout. L'ancien squelette ne le mentionnait pas — il n'aurait
 * jamais pu passer, même avec un navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LA VERSION PRÉCÉDENTE (SQUELETTE) AFFIRMAIT À TORT
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. « PATCH /payroll/entries/:id »      → n'existe pas. Les routes réelles
 *      sont POST /payroll/generate, GET /payroll/runs, GET /payroll/runs/:id,
 *      POST /payroll/entries/:id/lines, POST /payroll/runs/:id/finalize
 *      (payroll.controller.ts). Il n'y a ni PUT ni PATCH sur la paie.
 *   2. « 422 PAYROLL_RUN_LOCKED »          → ce code n'existe NULLE PART dans
 *      le dépôt ; les deux seules occurrences étaient dans ce fichier. Le code
 *      réellement renvoyé est PAYROLL_FINALIZED
 *      (« La paie est finalisée, modification impossible », 422 —
 *      payroll.service.ts:73). Une spec qui attend un code inexistant ne peut
 *      que passer au vert pour une mauvaise raison, ou échouer à jamais.
 *
 * Base fraîche à chaque run CI (`migrate.mjs --reset`), donc les mois 1/2/3
 * sont libres et chaque test génère sa propre période. Une période déjà
 * existante vaut 409 PAYROLL_ALREADY_EXISTS.
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { access_token: string }).access_token;
}

async function loginUi(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Bienvenue')).toBeVisible();
}

async function openPayroll(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Paie' }).click();
  await expect(page).toHaveURL(/\/payroll/);
}

/** Génère la paie depuis l'UI pour une période donnée, puis ouvre le détail. */
async function generateRunUi(page: import('@playwright/test').Page, month: number): Promise<void> {
  await openPayroll(page);
  await page.getByLabel('Année').fill(String(new Date().getFullYear()));
  await page.getByLabel('Mois').fill(String(month));
  await page.getByRole('button', { name: 'Générer la paie' }).click();
  await expect(page.getByText('Paie générée (draft)')).toBeVisible();
  // PayrollPage ouvre automatiquement le détail du run créé (openRun). Le
  // titre garantit qu'on regarde bien la période demandée, pas un ancien run.
  await expect(page.getByText(`Période ${String(month).padStart(2, '0')}/${new Date().getFullYear()} — Bulletins`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finaliser' })).toBeVisible();
}

/** Retourne le run d'une période, avec ses entrées. */
async function runOf(
  request: APIRequestContext,
  token: string,
  month: number,
): Promise<{ id: string; status: string; entries: Array<{ id: string }> }> {
  const year = new Date().getFullYear();
  const res = await request.post('/api/v1/payroll/generate', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { period_year: year, period_month: month },
  });
  // Le job CI repart d'une base resetée et ce test réserve le mois 3. Un
  // doublon est donc une contamination de fixture : on le fait échouer au lieu
  // de réutiliser silencieusement un run possiblement déjà finalisé.
  expect(res.status(), `generate ${year}-${month}`).toBe(201);
  const created = (await res.json()) as { id: string; status: string };
  const detail = (await (
    await request.get(`/api/v1/payroll/runs/${created.id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { id: string; status: string; entries: Array<{ id: string }> };
  return detail;
}

test.describe('payroll — run → ligne → finalize → blocage', () => {
  test('génération d’un run + ajout de ligne avant finalisation', async ({ page }) => {
    await loginUi(page);
    await generateRunUi(page, 1);

    // Le bulletin est éditable tant que le run est en draft : la colonne
    // « Actions » porte le bouton « Ajouter une ligne ».
    await page.getByRole('button', { name: 'Ajouter une ligne' }).first().click();
    await page.getByLabel('Libellé').fill('Prime e2e');
    await page.getByLabel('Montant (DZD)').fill('5000');

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Ligne ajoutée')).toBeVisible();
    // Le détail est rechargé après l'ajout : le run est toujours draft.
    await expect(page.getByRole('button', { name: 'Finaliser' })).toBeVisible();
  });

  test('finalisation → les contrôles de modification disparaissent', async ({ page }) => {
    await loginUi(page);
    await generateRunUi(page, 2);

    await page.getByRole('button', { name: 'Finaliser' }).click();
    await expect(page.getByText('Paie finalisée (immuable)')).toBeVisible();

    // R15 côté UI : plus aucun moyen de modifier. Le bouton « Finaliser » et
    // les « Ajouter une ligne » sont conditionnés à status === 'draft' dans
    // PayrollPage ; après finalisation la colonne Actions affiche « — ».
    await expect(page.getByRole('button', { name: 'Finaliser' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);

    // Et après rechargement complet (le verrou est serveur, pas un état
    // d'affichage qui survivrait à un rafraîchissement).
    await page.reload();
    await openPayroll(page);
    await page.getByRole('button', { name: 'Détail' }).first().click();
    await expect(page.getByText(`Période 02/${new Date().getFullYear()} — Bulletins`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finaliser' })).toHaveCount(0);
  });

  test('édition post-finalisation refusée par l’API (PAYROLL_FINALIZED)', async ({ page, request }) => {
    const token = await apiLogin(request);
    const run = await runOf(request, token, 3);
    expect(run.entries.length, 'aucun bulletin — le seed e2e a-t-il un employé ?').toBeGreaterThan(0);
    const entryId = run.entries[0].id;

    // Avant finalisation : la ligne passe.
    if (run.status === 'draft') {
      const before = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        data: { lines: [{ line_type: 'bonus', label_fr: 'Prime avant finalisation', amount: 5000 }] },
      });
      expect(before.status(), 'ligne acceptée avant finalisation').toBe(201);

      const fin = await request.post(`/api/v1/payroll/runs/${run.id}/finalize`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        data: {},
      });
      expect(fin.status()).toBeLessThan(300);
    }

    // Après finalisation : refus, et le code est PAYROLL_FINALIZED — pas le
    // PAYROLL_RUN_LOCKED inventé par l'ancien squelette.
    const after = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { lines: [{ line_type: 'bonus', label_fr: 'Prime post-finalisation', amount: 1000 }] },
    });
    expect(after.status()).toBe(422);
    expect(((await after.json()) as { code: string }).code).toBe('PAYROLL_FINALIZED');

    // L'UI est cohérente avec le refus serveur : aucun contrôle d'ajout.
    await loginUi(page);
    await openPayroll(page);
    await page.getByRole('button', { name: 'Détail' }).first().click();
    await expect(page.getByText(`Période 03/${new Date().getFullYear()} — Bulletins`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
  });
});
