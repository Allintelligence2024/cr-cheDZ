import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Playwright — exécuté en CI (job e2e) contre l'API réelle.
 * Prérequis : base migrée + seedée (+ seed-e2e.mjs), API et worker compilés.
 * L'API (port 3000), le worker (traitement des jobs) et le frontend Vite
 * (port 4000, proxy /api) sont démarrés automatiquement par webServer.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  // Rapport HTML produit même en CI : publié en artifact par le job e2e.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4000',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/v1/health',
      // B2 : la config vit dans apps/admin-web — sans cwd explicite, le
      // chemin apps/api/dist/main.js ne se résolvait jamais et les e2e ne
      // pouvaient pas démarrer. L'API se lance depuis la racine du monorepo.
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 60_000,
      // NODE_ENV=development + EMAIL_PROVIDER=none : seul mode où le jeton
      // d'invitation est remis dans la réponse (transport email non livré) —
      // nécessaire à invitation-flow.spec.ts. Hors development, l'API échoue
      // en 503 INVITATION_DELIVERY_UNAVAILABLE (vérifié par les suites).
      env: {
        ...process.env,
        APP_PORT: '3000',
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'none',
      } as Record<string, string>,
    },
    {
      // Worker : traite les jobs (exports Excel, PDF factures…) — requis par
      // export-download.spec.ts. Prérequis : `npm run build --workspace @creche/worker`.
      // Pas d'url/port : pas de sonde de readiness (Playwright démarre le
      // process et passe à la suite) ; le spec attend le résultat du job.
      command: 'node apps/worker/dist/main.js',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { ...process.env } as Record<string, string>,
    },
    {
      // Vite dev : cwd par défaut = dossier de cette config (apps/admin-web),
      // qui possède le script `dev`. Ne PAS mettre '../..' ici.
      command: 'npm run dev -- --port 4000 --strictPort',
      url: 'http://127.0.0.1:4000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
