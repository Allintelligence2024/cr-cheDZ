import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../shared/decorators/roles.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  /**
   * Configuration du tenant (flags + surcharges) : réservée à la direction.
   * Sans `@Roles`, la route était ouverte à **tout** utilisateur authentifié
   * (RLS empêchait la fuite inter-tenant, mais l'exposition restait inutile).
   */
  @Get()
  @Roles('director', 'super_admin')
  async list(): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.featureFlagsService.list() };
  }
}
