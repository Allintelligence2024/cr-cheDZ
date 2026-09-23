import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  /**
   * R14 (remédiation 2026-09-21, F12) : true pour les clients web
   * (admin-web, support-console) — l'API pose alors un cookie httpOnly
   * __Host-creche_refresh en complément du body. false (défaut) pour
   * les mobiles Flutter qui consomment toujours le refresh dans le body
   * (rétro-compat). Voir apps/api/src/shared/auth/auth-cookies.ts.
   */
  @IsOptional()
  @IsBoolean()
  web_client?: boolean;
}

export class RefreshDto {
  /**
   * R14 : optionnel — le web client peut envoyer le refresh dans le cookie
   * httpOnly (le serveur le lit alors via req.cookies). Pour les mobiles,
   * le token reste dans le body (rétro-compat flutter_secure_storage).
   * Au moins UNE des deux sources DOIT être fournie : le contrôleur vérifie
   * après la validation DTO.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  refresh_token?: string;

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

  /** Canal de livraison de l'OTP (défaut : sms). 'whatsapp' exige le flag global whatsapp_otp. */
  @IsOptional()
  @IsIn(['sms', 'whatsapp'], { message: 'canal invalide (sms ou whatsapp)' })
  channel?: 'sms' | 'whatsapp';
}

export class ParentOtpVerifyDto extends ParentOtpRequestDto {
  @Matches(/^\d{6}$/, { message: 'code à 6 chiffres' })
  code!: string;

  /** G5 : requis côté serveur dès que le compte a le second facteur actif. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code TOTP à 6 chiffres' })
  totp_code?: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}

export class ParentPinDto {
  @Matches(/^\d{4,6}$/, { message: 'PIN à 4 à 6 chiffres requis' })
  pin!: string;

  /** G5 : un compte MFA ne peut pas poser/remplacer son PIN sans prouver le facteur. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code TOTP à 6 chiffres' })
  totp_code?: string;
}

export class ParentPinLoginDto extends ParentOtpRequestDto {
  @Matches(/^\d{4,6}$/, { message: 'PIN à 4 à 6 chiffres requis' })
  pin!: string;

  /** G5 : second facteur obligatoire dès que totp_enabled, avec anti-rejeu partagé. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code TOTP à 6 chiffres' })
  totp_code?: string;

  @IsOptional()
  @IsString()
  device_id?: string;
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

  /**
   * R14 : identique à LoginDto.web_client — accepter une invitation ouvre
   * une session, le navigateur doit donc recevoir le cookie httpOnly du
   * refresh token, exactement comme après un login.
   *
   * Ce champ manquait alors qu'admin-web l'envoie déjà : avec
   * `forbidNonWhitelisted: true` (app.factory.ts), la requête partait en
   * 400 « property web_client should not exist » et l'activation de compte
   * échouait systématiquement depuis le navigateur.
   */
  @IsOptional()
  @IsBoolean()
  web_client?: boolean;
}
