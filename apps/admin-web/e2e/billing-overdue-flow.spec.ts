import { expect, test } from '@playwright/test';

/**
 * E2E S1 (remédiation 2026-09-21, Phase 4) — flux de facturation complet.
 *
 * Cible : directeur de crèche pilote.
 * Scénario :
 *   1. Création facture → 201, total cohérent avec les lignes
 *   2. Encaissement partiel → statut 'partially_paid', reliquat affiché
 *   3. Nouvelle tentative d'édition du partiellement_payé → bouton désactivé
 *      (cf. R19 — ligne « partially_paid non éditable »)
 *   4. Avance du temps (ou simule `mark_overdue` via API) → statut 'overdue'
 *   5. Tentative d'édition d'une facture overdue → 422 / bouton désactivé
 *
 * ⚠ Squelette — à exécuter sur la cible VPS avec :
 *   - DATABASE_URL pointant vers la base pilote
 *   - Playwright + navigateurs installés (`npx playwright install`)
 *   - Variables E2E_DIRECTOR_EMAIL / E2E_DIRECTOR_PASSWORD pointant vers
 *     un directeur de la crèche pilot-01 (cf. docs/pilot/ONBOARDING.md)
 *
 * PRÉREQUIS MANQUANTS en sandbox : navigateur, app réelle, base pilote.
 * Ce fichier est commité pour servir de spécification — voir
 * docs/PHASE4-MANUAL.md §S1 pour la procédure d'exécution.
 */
const EMAIL = process.env.E2E_DIRECTOR_EMAIL ?? 'pilot-01.directrice@pilote.dz';
const PASSWORD = process.env.E2E_DIRECTOR_PASSWORD ?? 'TODO_PASSWORD';

test.describe.skip('billing — flux facture → encaissement → overdue', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Bienvenue')).toBeVisible();
  });

  test('création facture', async ({ page, request }) => {
    // TODO : appeler POST /billing/invoices (via request) avec 2 lignes
    // (1 × repas + 1 × garde), vérifier 201 + total = SUM(lines).
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });

  test('encaissement partiel → statut partially_paid', async ({ page }) => {
    // TODO : naviguer vers la facture, cliquer « Encaisser », saisir un
    // montant < total, vérifier l'apparition du badge « Partiellement payé »
    // et du reliquat. Vérifier que la ligne invoice_lines n'est PAS éditable.
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });

  test('partially_paid non éditable (R19)', async ({ page }) => {
    // TODO : sur une facture partiellement_paid, vérifier que les boutons
    // « Modifier » / « Supprimer » sont absents ou disabled. Le contrôle
    // DB est `invoices_mark_overdue` SECURITY INVOKER + check R19 côté app.
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });

  test('facture overdue (R15)', async ({ page, request }) => {
    // TODO : via l'API POST /billing/invoices/:id/mark-overdue (director
    // only), basculer la facture. Vérifier l'UI badge « En retard » + le
    // blocage d'édition (cf. invoice_immutable — R15).
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });
});
