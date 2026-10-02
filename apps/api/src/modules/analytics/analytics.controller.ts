import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../shared/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, RatiosQueryDto, RevenueQueryDto } from './dto/analytics.dto';

const DIRECTOR_ROLES = ['super_admin', 'director', 'accountant'] as const;

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles(...DIRECTOR_ROLES)
  overview() {
    return this.analytics.overview();
  }

  @Get('attendance')
  @Roles(...DIRECTOR_ROLES)
  attendance(@Query() q: AnalyticsQueryDto) {
    return this.analytics.attendanceTrend(q.from, q.to, q.groupBy, q.site_id);
  }

  @Get('billing')
  @Roles(...DIRECTOR_ROLES)
  billing(@Query() q: RevenueQueryDto) {
    return this.analytics.billingTrend(q.from, q.to);
  }

  @Get('revenue')
  @Roles(...DIRECTOR_ROLES)
  revenue(@Query() q: RevenueQueryDto) {
    return this.analytics.revenueTrend(q.from, q.to);
  }

  @Get('occupancy')
  @Roles(...DIRECTOR_ROLES)
  occupancy() {
    return this.analytics.occupancy();
  }

  @Get('ratios')
  @Roles(...DIRECTOR_ROLES)
  ratios(@Query() q: RatiosQueryDto) {
    return this.analytics.ratiosHistory(q.date);
  }
}
