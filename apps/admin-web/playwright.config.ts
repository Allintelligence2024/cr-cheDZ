import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Playwright — exécuté en CI (job e2e) contre l'API réelle.
 * Prérequis : base migrée + seedée (+ seed-e2e.mjs), API compilée.
 * L'API (port 3000) et le frontend Vite (port 4000, proxy /api) sont
 * démarrés automatiquement par webServer.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4000',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { ...process.env, APP_PORT: '3000' } as Record<string, string>,
    },
    {
      command: 'npm run dev -- --port 4000 --strictPort',
      url: 'http://127.0.0.1:4000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
