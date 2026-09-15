import { Controller, Get, Header } from '@nestjs/common';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { MetricsService } from './metrics.service';

/** Endpoint /metrics au format Prometheus (text/plain, administrateur plateforme uniquement). */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Roles('super_admin')
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('cache-control', 'no-store')
  async index(@CurrentUser() user: CurrentUserPayload): Promise<string> {
    return this.metrics.scrape(user.sub);
  }
}
