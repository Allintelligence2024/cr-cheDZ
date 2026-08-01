import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(8, { message: 'empreinte d\'appareil trop courte' })
  device_fingerprint!: string;

  @IsString()
  @Matches(/^(android|ios|web)$/, { message: 'plateforme invalide' })
  platform!: string;

  @IsOptional()
  @IsString()
  app_version?: string;

  @IsOptional()
  @IsString()
  fcm_token?: string;

  @IsOptional()
  @IsString()
  apns_token?: string;
}
