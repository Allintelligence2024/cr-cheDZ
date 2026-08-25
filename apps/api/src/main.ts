import { createApp } from './app.factory';
import { assertProductionConfig } from '@creche/prod-config';

async function bootstrap(): Promise<void> {
  // MISSION P1 (feat(config)) : garde de config au boot — en production, un
  // secret par défaut / une config partielle empêche le démarrage (message
  // explicite listant chaque variable fautive). Inactive en test/dev.
  try {
    assertProductionConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  // Sentry (Phase 11) : activé uniquement si SENTRY_DSN est configuré —
  // jamais de faux envoi, aucune donnée sans DSN.
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0.1,
    });
  }
  const app = await createApp();
  const port = Number(process.env.APP_PORT ?? 3000);
  await app.listen(port);
  console.log(`API prête sur http://localhost:${port}/api/v1`);
}

void bootstrap();
