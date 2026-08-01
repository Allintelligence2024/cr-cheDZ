import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../shared/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/** Endpoint /metrics au format Prometheus (text/plain, public, sans PII). */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async index(): Promise<string> {
    return this.metrics.scrape();
  }
}
