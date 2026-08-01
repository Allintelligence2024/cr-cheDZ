import { IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
export class CreateContractDto {
 @IsUUID() child_id!: string;
 @IsNumber() @Min(0) monthly_base_amount!: number;
 @IsDateString() start_date!: string;
 @IsOptional() @IsDateString() end_date?: string;
 @IsOptional() @IsString() schedule_type?: string;
 @IsOptional() @IsNumber() @Min(0) @Max(100) discount_percent?: number;
}
export class GenerateInvoiceDto {
 @IsUUID() contract_id!: string;
 @IsInt() @Min(2020) period_year!: number;
 @IsInt() @Min(1) @Max(12) period_month!: number;
 @IsDateString() due_date!: string;
}
export class RecordCashPaymentDto {
 @IsUUID() invoice_id!: string;
 @IsNumber() @Min(0.01) amount!: number;
 @IsOptional() @IsString() notes?: string;
}
