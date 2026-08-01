import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const CHILD_STATUS = ['pre_registered', 'active', 'on_leave', 'departed'] as const;
const SCHEDULE_TYPES = ['full_time', 'half_time', 'daily', 'custom'] as const;

export class CreateChildDto {
  @IsUUID()
  site_id!: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

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

  @IsDateString({}, { message: 'date_of_birth invalide (YYYY-MM-DD)' })
  date_of_birth!: string;

  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: string;

  @IsOptional()
  @IsIn(CHILD_STATUS)
  status?: string;

  @IsOptional()
  @IsDateString()
  enrollment_date?: string;

  @IsOptional()
  @IsIn(SCHEDULE_TYPES)
  schedule_type?: string;

  @IsOptional()
  @IsBoolean()
  is_walking?: boolean;

  @IsOptional()
  @IsBoolean()
  has_special_needs?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  special_needs_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateChildDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name_fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name_ar?: string;

  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: string;

  @IsOptional()
  @IsIn(CHILD_STATUS)
  status?: string;

  @IsOptional()
  @IsDateString()
  enrollment_date?: string;

  @IsOptional()
  @IsDateString()
  departure_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  departure_reason?: string;

  @IsOptional()
  @IsIn(SCHEDULE_TYPES)
  schedule_type?: string;

  @IsOptional()
  @IsBoolean()
  is_walking?: boolean;

  @IsOptional()
  @IsBoolean()
  has_special_needs?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  special_needs_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class MoveRoomDto {
  @IsUUID()
  room_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListChildrenQuery {
  @IsOptional()
  @IsUUID()
  site_id?: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsIn(CHILD_STATUS)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
