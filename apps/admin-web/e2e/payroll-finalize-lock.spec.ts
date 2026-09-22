import { expect, test } from '@playwright/test';

/**
 * E2E S1 (remédiation 2026-09-21, Phase 4) — payroll : run → finalize →
 * blocage post-finalisation (R15).
 *
 * Cible : directeur de crèche pilote.
 * Scénario :
 *   1. Génération d'un run de paie → 200, statuts calculés
 *   2. Édition d'une ligne avant finalisation → OK
 *   3. Finalisation du run → badge « Finalisé » + bouton désactivé
 *   4. Édition d'une ligne APRÈS finalisation → 422 PAYROLL_RUN_LOCKED
 *      (le trigger migration 072 refuse l'UPDATE ; cf. R15, R19 P3 lot)
 *
 * ⚠ Squelette — à exécuter sur la cible VPS avec :
 *   - DATABASE_URL pointant vers la base pilote
 *   - Playwright + navigateurs installés (`npx playwright install`)
 *   - Variables E2E_DIRECTOR_EMAIL / E2E_DIRECTOR_PASSWORD pointant vers
 *     un directeur de la crèche pilot-01
 *
 * PRÉREQUIS MANQUANTS en sandbox : navigateur, app réelle, base pilote.
 * Ce fichier est commité pour servir de spécification — voir
 * docs/PHASE4-MANUAL.md §S1 pour la procédure d'exécution.
 */
const EMAIL = process.env.E2E_DIRECTOR_EMAIL ?? 'pilot-01.directrice@pilote.dz';
const PASSWORD = process.env.E2E_DIRECTOR_PASSWORD ?? 'TODO_PASSWORD';

test.describe.skip('payroll — run → finalize → blocage R15', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Bienvenue')).toBeVisible();
  });

  test('génération d\'un run + édition avant finalisation', async ({ page }) => {
    // TODO : POST /payroll/generate, puis PATCH /payroll/entries/:id (avec
    // un ajustement manuel), vérifier 200.
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });

  test('finalisation → badge + bouton désactivé', async ({ page }) => {
    // TODO : POST /payroll/runs/:id/finalize, vérifier le badge « Finalisé »
    // sur la page de détail + que le bouton « Éditer » est absent.
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });

  test('édition post-finalisation refusée (R15)', async ({ page, request }) => {
    // TODO : après finalisation, appeler PATCH /payroll/entries/:id/lines
    // directement via request, attendre 422 avec code PAYROLL_RUN_LOCKED.
    // Confirmer que la spec backend (phase62-payroll-finalized-lock) couvre
    // déjà le cas PG ; cette spec-ci valide l'UI (feedback utilisateur).
    test.skip(true, 'Squelette S1 — voir docs/PHASE4-MANUAL.md §S1');
  });
});
