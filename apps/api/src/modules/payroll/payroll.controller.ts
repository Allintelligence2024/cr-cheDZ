import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { AddLineDto, EntryIdParam, GeneratePayrollDto, RunIdParam } from './dto/payroll.dto';
import { PayrollService } from './payroll.service';

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Génère la paie du mois (idempotente : 409 si existante). */
  @Post('generate')
  @Roles('director', 'accountant', 'super_admin')
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() u: CurrentUserPayload) {
    return this.payroll.generate(u.sub, dto);
  }

  @Get('runs')
  @Roles('director', 'accountant', 'super_admin')
  runs() {
    return this.payroll.listRuns();
  }

  @Get('runs/:id')
  @Roles('director', 'accountant', 'super_admin')
  runDetail(@Param() p: RunIdParam) {
    return this.payroll.runDetail(p.id);
  }

  /** Ajoute des lignes (primes, indemnités, retenues) à une entrée — draft. */
  @Post('entries/:id/lines')
  @Roles('director', 'accountant', 'super_admin')
  addLines(@Param() p: EntryIdParam, @Body() dto: AddLineDto) {
    return this.payroll.addLine(p.id, dto);
  }

  /** Finalise la paie (immuable ensuite). */
  @Post('runs/:id/finalize')
  @Roles('director', 'accountant', 'super_admin')
  finalize(@Param() p: RunIdParam, @CurrentUser() u: CurrentUserPayload) {
    void u; return this.payroll.finalize(p.id);
  }
}
