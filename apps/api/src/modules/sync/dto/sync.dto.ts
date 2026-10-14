import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
  ValidateBy,
} from 'class-validator';
import { isSyncCursor } from '../generated/sync-contract';

/**
 * Types d'entité mutables offline — fixés par l'app mobile (4.2).
 *
 * `attendance_session` est la forme canonique envoyée par l'app courante ;
 * `attendance` est son alias historique — une base installée avec un build
 * antérieur l'envoie encore, et le refuser au niveau de l'ENVELOPPE ferait
 * échouer toute la push (400 global) au lieu de laisser le service répondre
 * par opération (accepted / rejected / conflict).
 *
 * `media` est volontairement accepté : la commande `add_photo` existe pour
 * être REFUSÉE par le service avec `OFFLINE_PHOTO_UNSUPPORTED` (décision D6
 * option c — le message nomme `POST /api/v1/media/upload`). Si le DTO la
 * rejetait, le client recevrait un 400 sec anonyme au lieu du refus expliqué,
 * et la garantie D6 (« la voie hors ligne n'écrit rien, et on le dit »)
 * disparaîtrait.
 */
export const SYNC_ENTITY_TYPES = [
  'attendance_session',
  'attendance',
  'daily_log',
  'media',
] as const;

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

  // Commande : enveloppe seulement. La liste SYNC_COMMANDS documente les
  // commandes connues (contrat mobile 4.2), mais la VALIDATION reste au
  // service : une commande inconnue doit être rejetée PAR OPÉRATION
  // (`rejected[0].reason === 'UNKNOWN_COMMAND'`, les autres opérations
  // passent), pas par un 400 global qui perd toute la push. C'est le contrat
  // frozen (`packages/sync-contract/sync.schema.json` : « envelopes, not
  // business payload validation ») et ce que vérifient phase5 et phase29.
  @IsString()
  @IsNotEmpty({ message: 'commande sync manquante' })
  command!: string;

  @IsString()
  @IsNotEmpty({ message: 'type d\'entité sync manquant' })
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
  // Never coerce through Number: PostgreSQL BIGINT exceeds JS safe integers.
  @ValidateBy({ name: 'isSyncCursor', validator: { validate: isSyncCursor } })
  cursor!: string;

  @IsUUID()
  device_id!: string;
}

export interface SyncPushResult {
  accepted: string[];
  rejected: Array<{ event_id: string; reason: string; message: string }>;
  conflicts: Array<{ event_id: string; reason: string; current_version: number }>;
  next_cursor: string;
}
