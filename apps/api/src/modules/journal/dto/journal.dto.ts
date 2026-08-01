import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const JOURNAL_EVENT_TYPES = [
  'meal', 'nap_start', 'nap_end', 'diaper', 'activity',
  'temperature', 'note', 'health_observation', 'incident',
] as const;

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'bottle'] as const;
const MEAL_QUANTITIES = ['none', 'little', 'half', 'good', 'all'] as const;
const NAP_QUALITIES = ['good', 'agitated', 'refused'] as const;
const DIAPER_TYPES = ['wet', 'dirty', 'both', 'dry'] as const;
const INCIDENT_SEVERITIES = ['minor', 'moderate', 'serious'] as const;

export class CreateJournalEventDto {
  @IsUUID()
  child_id!: string;

  @IsIn(JOURNAL_EVENT_TYPES)
  event_type!: string;

  @IsOptional()
  @IsDateString()
  occurred_at?: string;

  // Repas
  @IsOptional()
  @IsIn(MEAL_TYPES)
  meal_type?: string;

  @IsOptional()
  @IsIn(MEAL_QUANTITIES)
  meal_quantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meal_notes?: string;

  // Sieste
  @IsOptional()
  @IsDateString()
  nap_start_at?: string;

  @IsOptional()
  @IsDateString()
  nap_end_at?: string;

  @IsOptional()
  @IsIn(NAP_QUALITIES)
  nap_quality?: string;

  // Change
  @IsOptional()
  @IsIn(DIAPER_TYPES)
  diaper_type?: string;

  // Activité
  @IsOptional()
  @IsString()
  @MaxLength(200)
  activity_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  activity_notes?: string;

  // Santé
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(34)
  @Max(42)
  temperature_celsius?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  health_observation?: string;

  // Note
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note_text?: string;

  @IsOptional()
  @IsBoolean()
  note_is_private?: boolean;

  // Incident
  @IsOptional()
  @IsIn(INCIDENT_SEVERITIES)
  incident_severity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  incident_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  incident_action?: string;

  // Correction (append-only)
  @IsOptional()
  @IsUUID()
  corrects_event_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  correction_reason?: string;

  @IsOptional()
  @IsBoolean()
  visible_to_parents?: boolean;
}

export class GroupActionItemDto {
  @IsUUID()
  child_id!: string;
}

export class GroupJournalEventDto {
  @IsIn(['meal', 'diaper', 'nap_start', 'nap_end', 'activity'])
  event_type!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupActionItemDto)
  children!: GroupActionItemDto[];

  @IsOptional()
  @IsIn(MEAL_TYPES)
  meal_type?: string;

  @IsOptional()
  @IsIn(MEAL_QUANTITIES)
  meal_quantity?: string;

  @IsOptional()
  @IsIn(DIAPER_TYPES)
  diaper_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  activity_name?: string;

  @IsOptional()
  @IsDateString()
  occurred_at?: string;
}

export class JournalListQuery {
  @IsUUID()
  child_id!: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}

export class UpdateJournalVisibilityDto {
  @IsBoolean()
  visible_to_parents!: boolean;
}
