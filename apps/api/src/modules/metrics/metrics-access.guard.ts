import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { Errors } from '../../shared/errors';
import { PG_POOL } from '../../shared/database/database.provider';
import { ACCESS_TOKEN_PURPOSE } from '../../shared/auth/jwt-token-options';
import { principalEpochMatches, readPrincipalEpoch } from '../../shared/auth/principal-epoch';
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
 *  3. Sinon : 401 (absent/invalide/expiré/autre purpose, ou époque du
 *     principal dépassée — G4 : révocation de rôle/statut/mot de passe frappe
 *     ici avant toute lecture) ou 403 (rôles tenant porteurs d'une époque
 *     valide mais non super_admin ; verrouillage vu par le service).
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly collector: MetricsCollectorService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { metricsAuthority?: MetricsAuthority; user?: CurrentUserPayload }>();
    const token = this.extractBearer(request.headers.authorization);
    if (token && this.collector.accepts(token)) {
      request.metricsAuthority = 'collector';
      return true;
    }
    if (!token) throw Errors.unauthorized();
    let payload: CurrentUserPayload & { purpose?: string; roles?: string[]; epoch?: number };
    try {
      payload = await this.jwtService.verifyAsync<CurrentUserPayload & { purpose?: string; roles?: string[]; epoch?: number }>(token);
    } catch {
      throw Errors.unauthorized();
    }
    if (payload.purpose !== ACCESS_TOKEN_PURPOSE) throw Errors.unauthorized();
    // G4 : la voie admin est soumise à la même révocabilité globale que le
    // JwtAuthGuard (déchéance de super-adminité, suspension, mot de passe
    // changé, compte supprimé ⇒ époque dépassée ⇒ 401 AU GARDE, avant toute
    // exposition d'exposition de métriques). Les re-contrôles du service
    // (verrouillage, cohérence de rôle) restent en profondeur de défense.
    const epoch = await readPrincipalEpoch(this.pool, payload.sub);
    if (!principalEpochMatches(payload.epoch, epoch)) throw Errors.unauthorized();
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
