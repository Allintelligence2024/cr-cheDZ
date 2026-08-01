import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: string; version: string; time: string } {
    return {
      status: 'ok',
      version: '0.1.0',
      time: new Date().toISOString(),
    };
  }
}
