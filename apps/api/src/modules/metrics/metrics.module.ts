import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsCollectorService } from './metrics-collector.service';
import { MetricsService } from './metrics.service';

// Le JwtService est fourni par le JwtModule global de IdentityModule ; le
// garde de la route metrics n'a donc pas à importer un module d'auth (et
// aucune route hors metrics n'accepte le credential collecteur).
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsCollectorService, MetricsAccessGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
