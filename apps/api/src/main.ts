import { createApp } from './app.factory';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env.APP_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API prête sur http://localhost:${port}/api/v1`);
}

void bootstrap();
