import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * E2E S1 (remédiation 2026-09-21, Phase 4) — payroll : run → finalize →
 * blocage post-finalisation (R15).
 *
 * Pré-requis (cf. tests/tenant-isolation/seed-e2e.mjs) :
 *   - DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test
 *   - Migrate + seed + `node tests/tenant-isolation/seed-e2e.mjs`
 *   - L'API lancée via la config Playwright (cf. apps/admin-web/playwright.config.ts)
 *
 * Compte utilisé : `e2e.director@test.dz` / `Password123!` (pas pilot-01,
 * le seeder ne pose PAS de directeur pilot-01 — uniquement e2e.*).
 */
const EMAIL = 'e2e.director@test.dz';
const PASSWORD = 'Password123!';

/** Période UNIQUE par run pour éviter PAYROLL_ALREADY_EXISTS sur retry. */
const period = { year: 2030 + Math.floor(Math.random() * 50), month: 1 + Math.floor(Math.random() * 12) };

test.describe('payroll — run → finalize → blocage R15', () => {
  let accessToken: string;
  let runId: string;
  let entryId: string;

  test.beforeAll(async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(login.status(), 'login directeur e2e').toBe(200);
    const body = await login.json();
    accessToken = body.access_token;
  });

  test('1) génération d\'un run → 200, 2 entries créées', async ({ request }) => {
    const res = await request.post('/api/v1/payroll/generate', {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { period_year: period.year, period_month: period.month },
    });
    expect(res.status(), 'POST /payroll/generate').toBe(201);
    const run = await res.json();
    runId = run.id;
    expect(run.status).toBe('draft');
  });

  test('2) entry existe et est éditable AVANT finalisation', async ({ request }) => {
    const r = await request.get(`/api/v1/payroll/runs/${runId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(r.status()).toBe(200);
    const run = await r.json();
    const entries = run.entries ?? run.payroll_entries ?? [];
    expect(entries.length, 'au moins 1 entry').toBeGreaterThan(0);
    entryId = entries[0].id;
    const addLine = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      data: {
        lines: [{
          line_type: 'bonus',
          label_fr: 'Prime e2e pré-finalisation',
          amount: 1000,
        }],
      },
    });
    expect(addLine.status(), 'POST /payroll/entries/:id/lines pré-finalisation').toBeLessThan(300);
  });

  test('3) finalisation → 200, status finalized, total_gross > 0', async ({ request }) => {
    const res = await request.post(`/api/v1/payroll/runs/${runId}/finalize`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status(), 'POST /payroll/runs/:id/finalize').toBe(201);
    const run = await res.json();
    expect(run.status).toBe('finalized');
    expect(Number(run.total_gross), 'total_gross > 0').toBeGreaterThan(0);
  });

  test('4) édition APRÈS finalisation → 422 PAYROLL_RUN_LOCKED (R15)', async ({ request }) => {
    const addLine = await request.post(`/api/v1/payroll/entries/${entryId}/lines`, {
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      data: {
        lines: [{
          line_type: 'bonus',
          label_fr: 'Tentative post-finalisation',
          amount: 9999,
        }],
      },
    });
    expect(addLine.status(), 'POST /payroll/entries/:id/lines post-finalisation').toBe(422);
    const body = await addLine.json().catch(() => ({}));
    expect(body.code, 'code métier').toBe('PAYROLL_FINALIZED');
  });
});
