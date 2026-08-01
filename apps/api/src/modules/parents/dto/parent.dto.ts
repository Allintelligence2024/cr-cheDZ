import { IsBoolean, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class ChildIdParam {
  @IsUUID()
  childId!: string;
}

export class MediaIdParam {
  @IsUUID()
  mediaId!: string;
}

export class ReportAbsenceDto {
  @IsUUID()
  child_id!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SaveConsentDto {
  @IsUUID()
  child_id!: string;

  @IsString()
  consent_type!: string;

  @IsBoolean()
  granted!: boolean;
}

export class SaveNotificationPreferenceDto {
  @IsString()
  event_type!: string;

  @IsBoolean()
  is_enabled!: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quiet_hours_start?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quiet_hours_end?: string;
}
