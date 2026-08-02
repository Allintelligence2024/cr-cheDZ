import { Controller, Get } from '@nestjs/common';
import { Public } from '../../shared/decorators/public.decorator';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  /** Annuaire public des crèches (opt-in, flag marketplace). */
  @Public()
  @Get()
  list(): Promise<Array<Record<string, unknown>>> {
    return this.marketplace.list();
  }
}
