import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Ligne d'import — DTO VOLONTAIREMENT permissif : la validation métier
 * (dates, longueurs, cohérence) est faite par ImportService ligne par ligne
 * afin de produire un rapport d'erreurs FR/AR au lieu d'un 400 global.
 */
export class ImportChildRowDto {
  @IsOptional()
  @IsString()
  first_name_fr?: string;

  @IsOptional()
  @IsString()
  last_name_fr?: string;

  @IsOptional()
  @IsString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  room_id?: string;

  @IsOptional()
  @IsString()
  guardian_first_name?: string;

  @IsOptional()
  @IsString()
  guardian_last_name?: string;

  @IsOptional()
  @IsString()
  guardian_phone?: string;

  @IsOptional()
  @IsString()
  guardian_relationship?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportChildrenDto {
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportChildRowDto)
  rows!: ImportChildRowDto[];
}

export interface ImportError {
  row: number;
  field: string;
  message_fr: string;
  message_ar: string;
}

export interface ImportResult {
  dry_run: boolean;
  inserted: number;
  errors: ImportError[];
}
