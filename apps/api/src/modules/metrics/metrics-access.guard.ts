import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Errors } from '../../shared/errors';
import { ACCESS_TOKEN_PURPOSE } from '../../shared/auth/jwt-token-options';
import type { CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { MetricsCollectorService } from './metrics-collector.service';

export type MetricsAuthority = 'collector' | 'platform-admin';

/**
 * H2k — unique porte d'entrée de GET /api/v1/metrics (route rendue @Public()
 * pour que le JwtAuthGuard global ne tranche pas avant ce garde) :
 *
 *  1. Bearer opaque égal (digest constant-time) à un digest provisionné →
 *     autorité « collecteur » : lecture du scrape, AUCUN contexte utilisateur.
 *  2. Sinon, chemin H2j inchangé : JWT d'accès valide (purpose 'access'),
 *     rôle super_admin dans le token, puis relecture de l'autorité COURANTE
 *     du compte par le service (actif, non supprimé, non verrouillé).
 *  3. Sinon : 401 (absent/invalide/expiré/autre purpose) ou 403 (rôles
 *     tenant, administrateur déchu) — mêmes sémantiques qu'avant ; un
 *     collecteur provisionné ne rend la route publique sous aucune condition.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly collector: MetricsCollectorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { metricsAuthority?: MetricsAuthority; user?: CurrentUserPayload }>();
    const token = this.extractBearer(request.headers.authorization);
    if (token && this.collector.accepts(token)) {
      request.metricsAuthority = 'collector';
      return true;
    }
    if (!token) throw Errors.unauthorized();
    let payload: CurrentUserPayload & { purpose?: string; roles?: string[] };
    try {
      payload = await this.jwtService.verifyAsync<CurrentUserPayload & { purpose?: string; roles?: string[] }>(token);
    } catch {
      throw Errors.unauthorized();
    }
    if (payload.purpose !== ACCESS_TOKEN_PURPOSE) throw Errors.unauthorized();
    const effective = payload.roles?.length ? payload.roles : [payload.role];
    if (!effective.includes('super_admin')) throw Errors.forbidden();
    request.user = payload;
    request.metricsAuthority = 'platform-admin';
    return true;
  }

  private extractBearer(header?: string): string | null {
    if (!header) return null;
    const [scheme, token, ...rest] = header.split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0) return null;
    return token;
  }
}
