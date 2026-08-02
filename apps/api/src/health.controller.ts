import { Controller, Get } from '@nestjs/common';
import { Public } from './shared/decorators/public.decorator';

@Controller('health')
export class HealthController {
  /** Healthcheck public (nginx, orchestrateur, CI) — aucune donnée exposée. */
  @Public()
  @Get()
  health(): { status: string; version: string; time: string } {
    return {
      status: 'ok',
      version: '0.1.0',
      time: new Date().toISOString(),
    };
  }
}
