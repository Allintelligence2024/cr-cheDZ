import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class CreateEnrollmentRequestDto {
  @IsUUID() site_id!: string;
  @IsString() @MaxLength(80) child_first_name!: string;
  @IsString() @MaxLength(80) child_last_name!: string;
  @IsDateString() child_date_of_birth!: string;
  @IsString() @MaxLength(120) guardian_name!: string;
  @Matches(/^\+?[0-9]{8,15}$/) guardian_phone!: string;
  @IsOptional() @IsEmail() guardian_email?: string;
  @IsDateString() desired_start_date!: string;
  @IsOptional() @IsIn(['full_time', 'half_time', 'daily', 'custom']) schedule_type?: string;
  @IsOptional() @IsBoolean() has_sibling?: boolean;
  @IsOptional() @IsBoolean() is_staff_child?: boolean;
  @IsOptional() @IsString() @MaxLength(500) priority_notes?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class OfferPlaceDto {
  @IsUUID() room_id!: string;
  /** Jours de validité de l'offre (défaut 7). */
  @IsOptional() @IsInt() @Min(1) offer_days?: number;
}

export class DecideDto {
  @IsIn(['accepted', 'declined', 'withdrawn']) decision!: 'accepted' | 'declined' | 'withdrawn';
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class EnrollmentListQuery {
  @IsOptional() @IsUUID() site_id?: string;
  @IsOptional() @IsIn(['pending', 'waitlisted', 'offered', 'accepted', 'declined', 'withdrawn', 'expired']) status?: string;
}
