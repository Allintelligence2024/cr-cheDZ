import { Transform } from 'class-transformer';
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

/**
 * Types MIME acceptés pour les médias (photos + documents PDF).
 * Source unique partagée par `presign-upload` (dev), `POST /media/upload`
 * (production) et les formats connus du stockage.
 */
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/**
 * Champs du formulaire multipart `POST /media/upload` (LOT 2B).
 * Le fichier lui-même est validé par le contrôleur (type MIME + taille),
 * pas par class-validator : il ne transite pas par le JSON.
 */
export class UploadMediaDto {
  @IsOptional()
  @IsUUID()
  child_id?: string;

  @IsOptional()
  @IsUUID()
  log_event_id?: string;

  /**
   * Enfants présents sur la photo. En `multipart/form-data` (upload par
   * l'API), le champ arrive soit répété (tableau), soit en JSON, soit en
   * valeur unique — les trois formes sont normalisées ici. La déclaration est
   * INDISPENSABLE : sans elle, `all_consents_checked` reste faux et la photo
   * ne peut jamais être publiée aux parents.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) {
      if (value.length === 1 && typeof value[0] === 'string' && value[0].trim().startsWith('[')) {
        try { return JSON.parse(value[0]); } catch { return value; }
      }
      return value;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
      } catch { return [value]; }
    }
    return value;
  })
  @IsArray()
  @IsUUID('4', { each: true })
  children_in_photo?: string[];

  @IsOptional()
  @IsDateString()
  taken_at?: string;

  /** SHA-256 hexadécimal des octets (le client staff-mobile l'envoie déjà). */
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'checksum doit être un SHA-256 hexadécimal' })
  checksum?: string;

  /** En multipart, un booléen arrive en chaîne : 'true'/'1' → true. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' || value === '1' : value))
  @IsBoolean()
  exif_stripped?: boolean;
}

export class PresignUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @IsIn(MEDIA_MIME_TYPES)
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
