import { IsBoolean, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Zones autorisées (DPIA §2) — jamais sanitaires / change / sieste / infirmerie. */
export const VIDEO_ZONES = ['entrance', 'corridor', 'common_room', 'playground'] as const;

export class CreateCameraDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(VIDEO_ZONES as unknown as string[], { message: 'zone invalide (entrance, corridor, common_room, playground)' })
  zone!: string;
}

export class UpdateCameraDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class PresignClipDto {
  @IsUUID()
  camera_id!: string;

  @Matches(/^[\w.-]{1,120}$/, { message: 'nom de fichier invalide' })
  filename!: string;

  @IsIn(['video/mp4', 'video/webm', 'video/quicktime'], { message: 'type mime vidéo invalide' })
  mime_type!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200_000_000)
  size_bytes?: number;
}

export class RegisterClipDto {
  @IsUUID()
  camera_id!: string;

  @IsISO8601({}, { message: 'captured_at ISO 8601 requis' })
  captured_at!: string;

  // Anti path-traversal (audit) : aucun `..` nulle part dans la clé
  // (lookahead négatif) ; caractères sûrs uniquement, longueur ≤ 200.
  @Matches(/^(?!.*\.\.)[\w\-./]{1,200}$/, { message: 'storage_key invalide (chemin relatif sans ..)' })
  storage_key!: string;

  /**
   * @deprecated Ignoré côté serveur : le backend réel est dérivé UNIQUEMENT
   * de STORAGE_BACKEND de l'API (politique serveur — audit). Le champ reste
   * accepté pour ne pas casser forbidNonWhitelisted chez les clients existants.
   */
  @IsOptional()
  @IsIn(['local', 's3'])
  storage_backend?: 'local' | 's3';

  @IsOptional()
  @IsIn(['video/mp4', 'video/webm', 'video/quicktime'])
  mime_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200_000_000)
  size_bytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7200)
  duration_seconds?: number;
}

export class ListClipsQuery {
  @IsOptional()
  @IsUUID()
  camera_id?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
