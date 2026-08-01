import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../shared/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist', 'accountant'] as const;

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Tableau de bord : présences du jour par salle + alertes (tenant courant). */
  @Get('summary')
  @Roles(...STAFF_ROLES)
  summary(): Promise<Record<string, unknown>> {
    return this.dashboard.summary();
  }
}
