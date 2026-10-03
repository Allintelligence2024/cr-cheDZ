import {
  IsIn, IsOptional, IsUUID,
} from 'class-validator';
import { IsStrictIsoDate } from '../../../shared/validation/iso-date';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsStrictIsoDate()
  from?: string;

  @IsOptional()
  @IsStrictIsoDate()
  to?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: 'day' | 'week' | 'month' = 'day';

  @IsOptional()
  @IsUUID()
  site_id?: string;
}

export class RatiosQueryDto {
  @IsOptional()
  @IsStrictIsoDate()
  date?: string;
}

export class RevenueQueryDto {
  @IsOptional()
  @IsStrictIsoDate()
  from?: string;

  @IsOptional()
  @IsStrictIsoDate()
  to?: string;
}
