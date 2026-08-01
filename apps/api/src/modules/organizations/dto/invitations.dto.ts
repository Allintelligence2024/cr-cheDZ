import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'email invalide' })
  email!: string;

  @IsString()
  @Matches(/^(super_admin|director|educator|accountant|receptionist|parent_primary|parent_secondary)$/, {
    message: 'rôle inconnu',
  })
  role_slug!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  last_name?: string;

  @IsOptional()
  @IsUUID()
  site_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  room_ids?: string[];

  /** Requis quand l'appelant est super_admin (pas de tenant) ; sinon ignoré. */
  @IsOptional()
  @IsUUID()
  organization_id?: string;
}
