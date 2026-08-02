import { IsIn, IsString, Matches } from 'class-validator';

export class CreateExportDto {
  @IsIn(['attendance', 'invoices'])
  report_type!: string;

  /** Période : 'YYYY-MM' (factures) ou 'YYYY-MM-DD..YYYY-MM-DD' (présences). */
  @IsString()
  @Matches(/^\d{4}-\d{2}(-\d{2})?(\.\.\d{4}-\d{2}-\d{2})?$/)
  period!: string;
}

export class ExportIdParam {
  @IsString()
  @Matches(/^[0-9a-f-]{36}$/)
  id!: string;
}
