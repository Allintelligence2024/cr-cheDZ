import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGuardianDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  first_name_fr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name_ar?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  last_name_fr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name_ar?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  relationship!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone_primary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone_secondary?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  national_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  employer?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone_primary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone_secondary?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  employer?: string;
}

export class LinkGuardianDto {
  @IsUUID()
  guardian_id!: string;

  @IsOptional()
  @IsBoolean()
  is_legal_guardian?: boolean;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_journal?: boolean;

  @IsOptional()
  @IsBoolean()
  can_view_health?: boolean;

  @IsOptional()
  @IsBoolean()
  can_receive_invoices?: boolean;

  @IsOptional()
  @IsBoolean()
  can_pay_invoices?: boolean;

  @IsOptional()
  @IsBoolean()
  can_pickup?: boolean;

  @IsOptional()
  @IsBoolean()
  can_authorize_pickup?: boolean;

  @IsOptional()
  @IsBoolean()
  can_receive_push?: boolean;

  @IsOptional()
  @IsBoolean()
  receives_invoice_copies?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority_order?: number;
}

export class CreateEmergencyContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  first_name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  last_name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  relationship!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone_primary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone_secondary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority_order?: number;
}

export class CreatePickupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  first_name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  last_name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  relationship!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  national_id?: string;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;
}

export class UpdatePickupDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
