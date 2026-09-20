import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class CreateContractDto {
 @IsUUID() child_id!: string;
 // P2-2 : optionnel si daily_rate + annual_weeks sont fournis (lissage calculé).
 @IsOptional() @IsNumber() @Min(0) monthly_base_amount?: number;
 // P2-2 : semaine type (jours ISO 1=lundi … 7=dimanche), défaut DZ dim→jeu.
 @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekly_schedule?: number[];
 @IsOptional() @IsNumber() @Min(0.5) @Max(12) hours_per_day?: number;
 @IsOptional() @IsInt() @Min(1) @Max(52) annual_weeks?: number;
 @IsOptional() @IsNumber() @Min(0) daily_rate?: number;
 @IsOptional() @IsBoolean() absence_deduction?: boolean;
 @IsOptional() @IsNumber() @Min(0) extra_day_rate?: number;
 @IsDateString() start_date!: string;
 @IsOptional() @IsDateString() end_date?: string;
 // C8 : valeurs alignées sur la définition de contracts.schedule_type
 // (010_billing : full_time, half_time, daily, custom) — erreur 400 claire
 // au lieu d'une donnée libre silencieusement acceptée.
 @IsOptional() @IsIn(['full_time', 'half_time', 'daily', 'custom']) schedule_type?: string;
 @IsOptional() @IsNumber() @Min(0) @Max(100) discount_percent?: number;
}
export class GenerateInvoiceDto {
 @IsUUID() contract_id!: string;
 // B4 : borne haute — une année > 2100 n'a aucun sens métier (et permettait
 // d'encoder des données corrompues sans rejet).
 @IsInt() @Min(2020) @Max(2100) period_year!: number;
 @IsInt() @Min(1) @Max(12) period_month!: number;
 @IsDateString() due_date!: string;
}
export class RecordCashPaymentDto {
 @IsUUID() invoice_id!: string;
 @IsNumber() @Min(0.01) amount!: number;
 @IsOptional() @IsString() notes?: string;
}
export class OpenCashRegisterDto {
 @IsUUID() site_id!: string;
 @IsOptional() @IsNumber() @Min(0) opening_balance?: number;
}
export class CloseCashRegisterDto {
  @IsUUID() site_id!: string;
  @IsOptional() @IsString() notes?: string;
}
export class CreateOnlinePaymentDto {
  @IsUUID() invoice_id!: string;
  @IsIn(['cib', 'edahabia']) method!: 'cib' | 'edahabia';
}
export class AllocatePaymentDto {
  @IsUUID() invoice_id!: string;
  @IsNumber() @Min(0.01) amount_allocated!: number;
}
export class ContractIdParam { @IsUUID() contractId!: string; }
export class InvoiceIdParam { @IsUUID() invoiceId!: string; }
export class PaymentIdParam { @IsUUID() paymentId!: string; }
export class CashRegisterQueryDto {
  @IsOptional() @IsUUID() site_id?: string;
}
/** P2-3 : relance d'impayé. email = envoi réel (fail-closed) ; manual = trace d'un appel/entretien (notes requises). */
export class SendReminderDto {
  @IsIn([1, 2, 3]) level!: 1 | 2 | 3;
  @IsIn(['email', 'manual']) channel!: 'email' | 'manual';
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
