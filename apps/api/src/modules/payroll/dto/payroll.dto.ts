import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class GeneratePayrollDto {
  @IsInt() @Min(2020) period_year!: number;
  @IsInt() @Min(1) @Max(12) period_month!: number;
}

export class PayrollLineDto {
  @IsIn(['base', 'bonus', 'allowance', 'deduction'])
  line_type!: string;

  @IsString() @MaxLength(200)
  label_fr!: string;

  @IsOptional() @IsString() @MaxLength(200)
  label_ar?: string;

  @IsNumber() @Min(-999999)
  amount!: number;
}

export class AddLineDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollLineDto)
  lines!: PayrollLineDto[];
}

export class EntryIdParam {
  @IsUUID() id!: string;
}

export class RunIdParam {
  @IsUUID() id!: string;
}
