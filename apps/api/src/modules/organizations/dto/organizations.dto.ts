import {
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @Matches(/^[a-z0-9-]{3,64}$/, { message: 'slug invalide (a-z, 0-9, tirets)' })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name_fr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legal_name?: string;

  @IsOptional()
  @IsIn(['creche', 'jardin_enfants', 'multi_accueil'])
  establishment_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  registration_number?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  commune?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3)
  wilaya!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  max_children?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legal_name?: string;

  @IsOptional()
  @IsIn(['creche', 'jardin_enfants', 'multi_accueil'])
  establishment_type?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  max_children?: number;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class CreateSiteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name_fr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  commune?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  wilaya?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  authorized_capacity?: number;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  authorized_capacity?: number;

  @IsOptional()
  @IsIn([true, false])
  is_active?: boolean;
}

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name_fr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'site_id invalide',
  })
  site_id!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  min_age_months?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  max_age_months?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  max_capacity?: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  min_age_months?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  max_age_months?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  max_capacity?: number;

  @IsOptional()
  @IsIn([true, false])
  is_active?: boolean;
}
