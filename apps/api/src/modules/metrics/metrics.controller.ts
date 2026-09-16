import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import type { CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { MetricsAccessGuard, type MetricsAuthority } from './metrics-access.guard';
import { MetricsService } from './metrics.service';

/**
 * Endpoint /metrics au format Prometheus (text/plain).
 *  - H2j : JWT d'accès administrateur plateforme COURANT (relecture de
 *    l'autorité dans le service) ;
 *  - H2k : OU credential de collecteur provisionné (digests SHA-256 en env),
 *    strictement limité à ce scrape — jamais de repli public, jamais de
 *    mot de passe administrateur côté Prometheus.
 * @Public() retire seulement le garde JWT global : MetricsAccessGuard est LA
 * porte (401/403 comme avant, plus le chemin collecteur).
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @UseGuards(MetricsAccessGuard)
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('cache-control', 'no-store')
  async index(@Req() request: Request & { metricsAuthority?: MetricsAuthority; user?: CurrentUserPayload }): Promise<string> {
    if (request.metricsAuthority === 'collector') return this.metrics.scrapeCollector();
    return this.metrics.scrape((request.user as CurrentUserPayload).sub);
  }
}
