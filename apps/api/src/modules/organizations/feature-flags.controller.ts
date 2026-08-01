import { Controller, Get } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.featureFlagsService.list() };
  }
}
