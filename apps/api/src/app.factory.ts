import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './shared/context/request-context.middleware';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

/**
 * Fabrique d'application — utilisée par main.ts (production) et par les
 * tests d'intégration (tests/tenant-isolation/isolation.api.test.mjs).
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4000').split(','),
    credentials: true,
  });
  app.use(requestContextMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  return app;
}
