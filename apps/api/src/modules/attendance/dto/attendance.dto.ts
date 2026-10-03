import {
  IsIn, IsOptional, IsString,
  IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { IsStrictIsoDate } from '../../../shared/validation/iso-date';

export class CheckInDto {
  @IsUUID()
  child_id!: string;

  @IsOptional()
  @IsUUID()
  site_id?: string;

  /** Heure constatée (appareil) — optionnelle en HTTP, le serveur fait foi. */
  @IsOptional()
  @IsStrictIsoDate()
  occurred_at?: string;
}

export class CheckOutDto extends CheckInDto {}

export class MarkAbsentDto {
  @IsUUID()
  child_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsStrictIsoDate()
  occurred_at?: string;
}

export class CorrectAttendanceDto {
  @IsUUID()
  child_id!: string;

  @IsIn(['check_in', 'check_out', 'absent'])
  action!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsStrictIsoDate()
  occurred_at?: string;
}

export class AttendanceSummaryQuery {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsStrictIsoDate()
  date?: string;
}

/** Résultat d'une commande appliquée (HTTP ou sync). */
export interface CommandResult {
  status: 'accepted' | 'rejected' | 'conflict';
  reason?: string;
  message?: string;
  currentVersion?: number;
}
