import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpsertHealthRecordDto {
  @IsOptional() @IsString() @MaxLength(20) blood_type?: string;
  @IsOptional() @IsString() @MaxLength(120) family_doctor?: string;
  @IsOptional() @IsString() @MaxLength(30) doctor_phone?: string;
  @IsOptional() @IsString() @MaxLength(80) health_insurance?: string;
  @IsOptional() @IsString() @MaxLength(1000) chronic_conditions?: string;
  @IsOptional() @IsString() @MaxLength(1000) general_notes?: string;
}

export class CreateAllergyDto {
  @IsString() @MaxLength(200) allergen!: string;
  @IsIn(['food', 'medicine', 'environment', 'other']) allergen_type!: string;
  @IsIn(['mild', 'moderate', 'severe', 'life_threatening']) severity!: string;
  @IsOptional() @IsString() @MaxLength(500) reaction?: string;
  @IsOptional() @IsString() @MaxLength(500) treatment?: string;
  @IsOptional() @IsString() @MaxLength(500) emergency_protocol?: string;
  @IsOptional() @IsBoolean() confirmed_by_doctor?: boolean;
  @IsOptional() @IsDateString() diagnosed_date?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateAllergyDto {
  @IsOptional() @IsString() @MaxLength(200) allergen?: string;
  @IsOptional() @IsIn(['food', 'medicine', 'environment', 'other']) allergen_type?: string;
  @IsOptional() @IsIn(['mild', 'moderate', 'severe', 'life_threatening']) severity?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class CreateVaccinationDto {
  @IsString() @MaxLength(120) vaccine_name!: string;
  @IsOptional() @IsInt() @Min(1) dose_number?: number;
  @IsOptional() @IsDateString() administered_date?: string;
  @IsOptional() @IsDateString() next_dose_date?: string;
  @IsOptional() @IsString() @MaxLength(120) administered_by?: string;
  @IsOptional() @IsString() @MaxLength(80) lot_number?: string;
}

export class UpdateVaccinationDto {
  @IsOptional() @IsDateString() next_dose_date?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
}

export class CreateMedicationAuthorizationDto {
  @IsUUID() guardian_id!: string;
  @IsString() @MaxLength(120) medication_name!: string;
  @IsString() @MaxLength(120) dosage!: string;
  @IsString() @MaxLength(200) frequency!: string;
  @IsOptional() @IsString({ each: true }) administration_times?: string[];
  @IsDateString() start_date!: string;
  @IsOptional() @IsDateString() end_date?: string;
  @IsOptional() @IsString() @MaxLength(1000) special_instructions?: string;
}

export class RecordMedicationAdministrationDto {
  @IsUUID() authorization_id!: string;
  @IsDateString() administered_at!: string;
  @IsString() @MaxLength(120) dose_given!: string;
  @IsOptional() @IsString() @MaxLength(500) observations?: string;
}

export class ChildIdParam {
  @IsUUID() childId!: string;
}

export class AllergyIdParam {
  @IsUUID() id!: string;
}

export class VaccinationIdParam {
  @IsUUID() id!: string;
}

export class MedAuthIdParam {
  @IsUUID() id!: string;
}

export class MedAdminIdParam {
  @IsUUID() id!: string;
}
