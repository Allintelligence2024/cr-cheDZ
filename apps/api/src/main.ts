import { createApp } from './app.factory';

async function bootstrap(): Promise<void> {
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
  // eslint-disable-next-line no-console
  console.log(`API prête sur http://localhost:${port}/api/v1`);
}

void bootstrap();
