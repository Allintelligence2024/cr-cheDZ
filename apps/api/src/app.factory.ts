import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './shared/context/request-context.middleware';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MetricsService } from './modules/metrics/metrics.service';
import { metricsMiddleware } from './shared/metrics.middleware';
import cookieParser from 'cookie-parser';

/**
 * Fabrique d'application — utilisée par main.ts (production) et par les
 * tests d'intégration (tests/tenant-isolation/isolation.api.test.mjs).
 */
export async function createApp(): Promise<INestApplication> {
  // rawBody: conserve le corps brut (req.rawBody) pour la vérification HMAC
  // du webhook de paiement (apps/api/src/modules/billing/billing.controller.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });

  // Exactly one ingress hop. Production API must remain private behind nginx,
  // which overwrites X-Forwarded-For; never trust an arbitrary chain.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4000').split(','),
    credentials: true, // R14 : requis pour que le navigateur envoie le cookie httpOnly cross-origin
  });
  // R14 (remédiation 2026-09-21, F12) — parser de cookies pour le refresh
  // token httpOnly (cf. apps/api/src/shared/auth/auth-cookies.ts). Sans
  // secret de signature : le cookie n'a pas besoin d'être signé, il est déjà
  // httpOnly + Secure + SameSite=Lax ; un secret ici n'apporte que pour
  // `req.signedCookies` qu'on n'utilise pas.
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  // Phase 11 : comptage HTTP pour /metrics (aucune PII).
  const metricsService = app.get(MetricsService);
  app.use(metricsMiddleware(metricsService));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  return app;
}
