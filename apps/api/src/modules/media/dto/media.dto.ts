import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PresignUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  mime_type!: string;

  @IsOptional()
  @IsUUID()
  child_id?: string;

  @IsOptional()
  @IsUUID()
  log_event_id?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  children_in_photo?: string[];

  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  file_size_bytes?: number;
}

export class RegisterMediaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  // C7 : aligné sur le DTO vidéo — aucun `..` (lookahead négatif), caractères
  // sûrs uniquement. Les gardes finales restent assertStorageKeyInTenant (API)
  // et la contrainte DB 049_storage_key_safety.
  @Matches(/^(?!.*\.\.)[\w\-./]{1,500}$/, { message: 'storage_key invalide (chemin relatif sans ..)' })
  storage_key!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  mime_type!: string;

  @IsOptional()
  @IsUUID()
  child_id?: string;

  @IsOptional()
  @IsUUID()
  log_event_id?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  children_in_photo?: string[];

  @IsOptional()
  @IsDateString()
  taken_at?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  file_size_bytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  original_filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  checksum?: string;

  @IsOptional()
  @IsBoolean()
  exif_stripped?: boolean;
}

export class UpdateMediaVisibilityDto {
  @IsBoolean()
  is_visible_to_parents!: boolean;
}

export class ListMediaQuery {
  @IsOptional()
  @IsUUID()
  child_id?: string;
}
