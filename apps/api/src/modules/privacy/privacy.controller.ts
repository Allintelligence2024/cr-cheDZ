import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { PrivacyService } from './privacy.service';

class CreatePrivacyRequestDto {
  @IsIn(['access', 'rectification', 'opposition'])
  request_type!: string;

  @IsOptional()
  @IsUUID()
  subject_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class CreateViolationDto {
  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  data_categories?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  affected_subjects?: number;

  @IsOptional()
  @IsIn(['low', 'moderate', 'high', 'critical'])
  severity?: string;

  @IsOptional()
  @IsString()
  occurred_at?: string;
}

class CreateDpiaDto {
  @IsUUID()
  processing_registry_id!: string;

  @IsOptional()
  @IsObject()
  risk_assessment?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mitigation_measures?: string[];
}

class IdParam {
  @IsUUID()
  id!: string;
}

class ImpersonateDto {
  @IsUUID()
  user_id!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

class SetFlagDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsIn([true, false])
  is_enabled!: boolean;
}

const STAFF_ROLES = ['director', 'accountant', 'super_admin'] as const;

@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  // ── Registre + DPIA ───────────────────────────────────────────────────────

  @Get('privacy/registry')
  @Roles(...STAFF_ROLES)
  registry() { return this.privacy.registry(); }

  @Get('privacy/dpias')
  @Roles(...STAFF_ROLES)
  dpias() { return this.privacy.listDpias(); }

  @Post('privacy/dpias')
  @Roles('director', 'super_admin')
  createDpia(@Body() dto: CreateDpiaDto, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.createDpia(u.sub, dto);
  }

  @Post('privacy/dpias/:id/approve')
  @Roles('director', 'super_admin')
  approveDpia(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.approveDpia(p.id, u.sub);
  }

  // ── Demandes de droits ────────────────────────────────────────────────────

  @Get('privacy/requests')
  requests(@CurrentUser() u: CurrentUserPayload) {
    return this.privacy.listRequests(u.sub, u.role);
  }

  @Post('privacy/requests')
  createRequest(@Body() dto: CreatePrivacyRequestDto, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.createRequest(u.sub, u.role, dto);
  }

  @Get('privacy/requests/:id')
  requestDetail(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.getRequest(p.id, u.sub, u.role);
  }

  @Post('privacy/requests/:id/export')
  exportRequest(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.exportRequest(p.id, u.sub, u.role);
  }

  @Post('privacy/requests/:id/resolve')
  @Roles('director', 'super_admin')
  resolveRequest(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.resolveRequest(p.id, u.sub);
  }

  // ── Violations (chrono 5 jours ANPDP) ─────────────────────────────────────

  @Get('privacy/violations')
  @Roles(...STAFF_ROLES)
  violations() { return this.privacy.listViolations(); }

  @Post('privacy/violations')
  @Roles('director', 'super_admin')
  createViolation(@Body() dto: CreateViolationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.createViolation(u.sub, dto);
  }

  @Post('privacy/violations/:id/anpdp-notify')
  @Roles('director', 'super_admin')
  notifyAnpdp(@Param() p: IdParam) {
    return this.privacy.notifyAnpdp(p.id);
  }

  // ── Console support (super_admin uniquement) ──────────────────────────────

  @Get('support/search')
  @Roles('super_admin')
  search(@Query('q') q?: string) {
    return this.privacy.globalSearch(q ?? '');
  }

  @Post('support/impersonate')
  @Roles('super_admin')
  impersonate(@Body() dto: ImpersonateDto, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.impersonate(u.sub, dto);
  }

  @Get('support/jobs')
  @Roles('super_admin')
  jobs() { return this.privacy.listJobs(); }

  @Post('support/jobs/:id/retry')
  @Roles('super_admin')
  retryJob(@Param() p: IdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.retryJob(p.id, u.sub);
  }

  @Get('support/flags')
  @Roles('super_admin')
  flags() { return this.privacy.listFlags(); }

  /** Suivi pilote : agrégats par organisation (super_admin uniquement). */
  @Get('support/pilot-summary')
  @Roles('super_admin')
  pilotSummary() { return this.privacy.pilotSummary(); }

  @Post('support/flags/:key')
  @Roles('super_admin')
  setFlag(@Param('key') key: string, @Body() dto: SetFlagDto, @CurrentUser() u: CurrentUserPayload) {
    return this.privacy.setFlag(key, dto, u.sub);
  }
}
