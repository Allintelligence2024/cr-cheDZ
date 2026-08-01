import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../errors';

interface ErrorBody {
  statusCode: number;
  code: string;
  message_fr: string;
  message_ar: string;
  details?: unknown;
  correlation_id?: string;
  timestamp: string;
  path: string;
}

/**
 * Filtre global d'exceptions.
 * - AppError        → statut + code + messages FR/AR
 * - HttpException   → code dérivé du statut (ou du message si code métier)
 * - Autres          → 500 INTERNAL, log sans PII
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body: ErrorBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message_fr: 'Erreur interne. Réessayez plus tard',
      message_ar: 'خطأ داخلي. أعد المحاولة لاحقاً',
      correlation_id: request.correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (exception instanceof AppError) {
      body.statusCode = exception.status;
      body.code = exception.code;
      body.message_fr = exception.messageFr;
      body.message_ar = exception.messageAr;
      if (exception.details !== undefined) body.details = exception.details;
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      body.statusCode = status;
      body.code = this.codeFromStatus(status);
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string' ? raw : (raw as Record<string, unknown>).message;
      if (typeof message === 'string' && message.includes('_')) {
        body.code = message; // codes métier passés via BadRequestException('CODE')
      }
      body.message_fr = this.frFromStatus(status);
      body.message_ar = this.arFromStatus(status);
      if (Array.isArray(message)) body.details = message;
    } else {
      this.logger.error(
        `[${request.correlationId}] ${request.method} ${request.url}`,
        exception instanceof Error ? `${exception.message}\n${exception.stack}` : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'VALIDATION';
      case 429: return 'RATE_LIMITED';
      default: return 'INTERNAL_ERROR';
    }
  }

  private frFromStatus(status: number): string {
    switch (status) {
      case 400: return 'Requête invalide';
      case 401: return 'Authentification requise';
      case 403: return 'Accès refusé';
      case 404: return 'Ressource introuvable';
      case 409: return 'Conflit de données';
      case 422: return 'Données invalides';
      case 429: return 'Trop de tentatives. Réessayez plus tard';
      default: return 'Erreur interne. Réessayez plus tard';
    }
  }

  private arFromStatus(status: number): string {
    switch (status) {
      case 400: return 'طلب غير صالح';
      case 401: return 'مطلوب تسجيل الدخول';
      case 403: return 'تم رفض الوصول';
      case 404: return 'المورد غير موجود';
      case 409: return 'تعارض في البيانات';
      case 422: return 'بيانات غير صالحة';
      case 429: return 'محاولات كثيرة جداً. أعد المحاولة لاحقاً';
      default: return 'خطأ داخلي. أعد المحاولة لاحقاً';
    }
  }
}
