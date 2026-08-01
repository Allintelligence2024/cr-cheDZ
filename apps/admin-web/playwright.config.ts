import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Playwright — exécuté en CI (job e2e) contre l'API réelle.
 * Prérequis : base migrée + seedée, API démarrée (webServer ci-dessous).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4000',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm run dev -- --port 4000 --strictPort',
      url: 'http://127.0.0.1:4000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
