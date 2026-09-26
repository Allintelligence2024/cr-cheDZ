import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadDotEnv(): Record<string, string> {
  const envPath = `${__dirname}/../../.env`;
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) out[key] = value;
    }
  } catch {
    // ignore missing .env
  }
  return out;
}

const dotEnv = loadDotEnv();

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4000',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/v1/health',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...process.env,
        ...dotEnv,
        APP_PORT: '3000',
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'none',
      } as Record<string, string>,
    },
    {
      command: 'node apps/worker/dist/main.js',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...process.env,
        ...dotEnv,
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'none',
      } as Record<string, string>,
    },
    {
      command: 'npm run dev -- --port 4000 --strictPort',
      url: 'http://127.0.0.1:4000',
      cwd: '.',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
