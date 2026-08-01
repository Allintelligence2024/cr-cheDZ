import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/** Commandes offline supportées (enum sync_command). */
export const SYNC_COMMANDS = [
  'check_in',
  'check_out',
  'mark_absent',
  'log_meal',
  'log_nap_start',
  'log_nap_end',
  'log_diaper',
  'log_activity',
  'log_temperature',
  'log_note',
  'add_photo',
  'log_incident',
  'correct_attendance',
] as const;

export class SyncOperationDto {
  @IsUUID()
  event_id!: string;

  @IsInt()
  @Min(1)
  client_sequence!: number;

  @IsInt()
  @Min(1)
  schema_version!: number;

  @IsString()
  command!: string;

  @IsString()
  entity_type!: string;

  @IsOptional()
  @IsUUID()
  entity_id?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  base_version?: number;

  @IsString()
  occurred_at_device!: string;
}

export class SyncPushDto {
  @IsUUID()
  device_id!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations!: SyncOperationDto[];
}

export class SyncPullQuery {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cursor!: number;

  @IsUUID()
  device_id!: string;
}

export interface SyncPushResult {
  accepted: string[];
  rejected: Array<{ event_id: string; reason: string; message: string }>;
  conflicts: Array<{ event_id: string; reason: string; current_version: number }>;
  next_cursor: number;
}
