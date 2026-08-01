import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'email invalide' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'mot de passe trop court' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code TOTP à 6 chiffres' })
  totp_code?: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(16)
  refresh_token!: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  old_password!: string;

  @IsString()
  @MinLength(8, { message: 'le nouveau mot de passe doit faire au moins 8 caractères' })
  @MaxLength(128)
  new_password!: string;
}

export class TotpDto {
  @Matches(/^\d{6}$/, { message: 'code à 6 chiffres' })
  code!: string;
}

export class ParentOtpRequestDto {
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'numéro de téléphone invalide' })
  phone!: string;
}

export class ParentOtpVerifyDto extends ParentOtpRequestDto {
  @Matches(/^\d{6}$/, { message: 'code à 6 chiffres' })
  code!: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}

export class ParentPinDto {
  @Matches(/^\d{4,6}$/, { message: 'PIN à 4 à 6 chiffres requis' })
  pin!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(16, { message: 'token d\'invitation invalide' })
  invitation_token!: string;

  @IsString()
  @MinLength(2, { message: 'prénom requis' })
  @MaxLength(100)
  first_name!: string;

  @IsString()
  @MinLength(2, { message: 'nom requis' })
  @MaxLength(100)
  last_name!: string;

  @IsString()
  @MinLength(8, { message: 'le mot de passe doit faire au moins 8 caractères' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}
