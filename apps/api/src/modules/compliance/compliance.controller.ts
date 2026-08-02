import { Controller, Get, Param, Post } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';

class CheckIdParam {
  @IsUUID()
  id!: string;
}

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Exécute et renvoie les checks du décret 19-253 (persistés dans compliance_checks). */
  @Get('summary')
  @Roles('super_admin', 'director', 'accountant')
  summary(): Promise<{ checked_at: string; results: Array<Record<string, unknown>> }> {
    return this.compliance.runChecks();
  }

  @Get('checks')
  @Roles('super_admin', 'director', 'accountant')
  checks(): Promise<Array<Record<string, unknown>>> {
    return this.compliance.listChecks();
  }

  @Post('checks/:id/acknowledge')
  @Roles('super_admin', 'director')
  acknowledge(@Param() p: CheckIdParam, @CurrentUser() u: CurrentUserPayload): Promise<Record<string, unknown>> {
    return this.compliance.acknowledge(p.id, u.sub);
  }
}
