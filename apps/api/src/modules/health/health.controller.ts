import { Body, Controller, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import {
  AllergyIdParam, ChildIdParam, CreateAllergyDto, CreateMedicationAuthorizationDto,
  CreateVaccinationDto, MedAdminIdParam, MedAuthIdParam, RecordMedicationAdministrationDto,
  UpdateAllergyDto, UpdateVaccinationDto, UpsertHealthRecordDto, VaccinationIdParam,
} from './dto/health.dto';
import { HealthService } from './health.service';

const STAFF_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;
const CARE_ROLES = ['super_admin', 'director', 'educator', 'receptionist'] as const;

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get(':childId')
  @Roles(...STAFF_ROLES)
  record(@Param() p: ChildIdParam, @CurrentUser() u: CurrentUserPayload, @Req() req: Request) {
    return this.health.getRecord(p.childId, u.sub, req.ip);
  }

  @Put(':childId')
  @Roles(...CARE_ROLES)
  upsert(@Param() p: ChildIdParam, @Body() dto: UpsertHealthRecordDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.upsertRecord(p.childId, dto, u.sub);
  }

  @Post(':childId/allergies')
  @Roles(...CARE_ROLES)
  allergy(@Param() p: ChildIdParam, @Body() dto: CreateAllergyDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.createAllergy(p.childId, dto, u.sub);
  }

  @Patch('allergies/:id')
  @Roles('super_admin', 'director')
  allergyUpdate(@Param() p: AllergyIdParam, @Body() dto: UpdateAllergyDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.updateAllergy(p.id, dto, u.sub);
  }

  @Post(':childId/vaccinations')
  @Roles(...CARE_ROLES)
  vaccination(@Param() p: ChildIdParam, @Body() dto: CreateVaccinationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.createVaccination(p.childId, dto, u.sub);
  }

  @Patch('vaccinations/:id')
  @Roles('super_admin', 'director')
  vaccinationUpdate(@Param() p: VaccinationIdParam, @Body() dto: UpdateVaccinationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.updateVaccination(p.id, dto, u.sub);
  }

  @Post(':childId/medication-authorizations')
  @Roles('super_admin', 'director', 'educator')
  medAuth(@Param() p: ChildIdParam, @Body() dto: CreateMedicationAuthorizationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.createMedicationAuthorization(p.childId, dto);
  }

  @Post('medication-authorizations/:id/verify')
  @Roles('super_admin', 'director')
  medAuthVerify(@Param() p: MedAuthIdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.health.verifyMedicationAuthorization(p.id, u.sub);
  }

  @Post(':childId/medication-administrations')
  @Roles(...CARE_ROLES)
  administration(@Param() p: ChildIdParam, @Body() dto: RecordMedicationAdministrationDto, @CurrentUser() u: CurrentUserPayload) {
    return this.health.recordAdministration(p.childId, dto, u.sub);
  }

  @Post('medication-administrations/:id/confirm')
  @Roles(...CARE_ROLES)
  administrationConfirm(@Param() p: MedAdminIdParam, @CurrentUser() u: CurrentUserPayload) {
    return this.health.confirmAdministration(p.id, u.sub);
  }
}
