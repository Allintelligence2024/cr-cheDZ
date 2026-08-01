import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @IsUUID()
  user_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  employee_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  national_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cnas_number?: string;

  @IsString()
  @IsIn(['educator_qualified', 'director', 'nurse', 'admin', 'other'])
  qualification!: string;

  @IsDateString()
  hire_date!: string;

  @IsOptional()
  @IsIn(['permanent', 'fixed_term', 'part_time'])
  contract_type?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_salary?: number;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergency_contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergency_contact_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  employee_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  national_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cnas_number?: string;

  @IsOptional()
  @IsIn(['educator_qualified', 'director', 'nurse', 'admin', 'other'])
  qualification?: string;

  @IsOptional()
  @IsIn(['permanent', 'fixed_term', 'part_time'])
  contract_type?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_salary?: number;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn([true, false])
  is_active?: boolean;
}

export class CreateStaffDocumentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  document_type!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(3)
  storage_key!: string;

  @IsOptional()
  @IsDateString()
  issued_date?: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuing_authority?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  alert_days_before?: number;
}

export class CreateStaffAssignmentDto {
  @IsUUID()
  room_id!: string;

  @IsOptional()
  @IsUUID()
  site_id?: string;

  @IsOptional()
  @IsIn([true, false])
  is_primary?: boolean;

  @IsDateString()
  start_date!: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class StaffAttendanceDto {
  @IsDateString()
  attendance_date!: string;

  @IsOptional()
  @IsDateString()
  check_in?: string;

  @IsOptional()
  @IsDateString()
  check_out?: string;

  @IsOptional()
  @IsIn(['present', 'vacation', 'sick', 'training', 'other'])
  absence_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
