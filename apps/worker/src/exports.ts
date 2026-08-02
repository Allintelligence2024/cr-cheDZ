/**
 * Exports Excel (roadmap v2) — génération côté worker via exceljs.
 * Les fichiers sont stockés sur le backend configuré (local ou S3) et la
 * référence est enregistrée dans report_exports (migration 038).
 */
import ExcelJS from 'exceljs';
import { storeFile } from './pdf';

export interface ExportPayload {
  export_id: string;
  report_type: 'attendance' | 'invoices';
  period_label: string;
  /** attendance : [startDate, endDate] (YYYY-MM-DD) ; invoices : [year, month] */
  range: [string, string];
}

/** Colonnes explicites (header ↔ clé) — le mapping par normalisation du
 * header casserait les accents (« Période » → « p_riode »). */
const COLUMNS: Record<ExportPayload['report_type'], Array<{ header: string; key: string }>> = {
  attendance: [
    { header: 'Référence', key: 'reference' },
    { header: 'Prénom', key: 'prenom' },
    { header: 'Nom', key: 'nom' },
    { header: 'Salle', key: 'salle' },
    { header: 'Date', key: 'date' },
    { header: 'Statut', key: 'statut' },
    { header: 'Arrivée', key: 'arrivee' },
    { header: 'Départ', key: 'depart' },
  ],
  invoices: [
    { header: 'N° facture', key: 'n_facture' },
    { header: 'Enfant', key: 'enfant' },
    { header: 'Période', key: 'periode' },
    { header: 'Total (DZD)', key: 'total_dzd' },
    { header: 'Payé (DZD)', key: 'paye_dzd' },
    { header: 'Solde (DZD)', key: 'solde_dzd' },
    { header: 'Statut', key: 'statut' },
    { header: 'Échéance', key: 'echeance' },
  ],
};

/** Construit le classeur Excel (présences ou factures) à partir des lignes. */
export function buildWorkbook(reportType: ExportPayload['report_type'], rows: Array<Record<string, unknown>>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(reportType === 'attendance' ? 'Présences' : 'Factures');
  const columns = COLUMNS[reportType];
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  for (const r of rows) {
    ws.addRow(columns.map((c) => (r as Record<string, unknown>)[c.key] ?? ''));
  }
  ws.columns.forEach((col) => { if (col) col.width = 22; });
  return wb;
}

/** Construit le fichier Excel (Buffer) à partir des lignes. */
export async function buildXlsx(reportType: ExportPayload['report_type'], rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const wb = buildWorkbook(reportType, rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from(await (wb as any).xlsx.writeBuffer());
}

/** Enregistre l'export sur le backend (clé identique API/worker). */
export async function storeExport(orgId: string, exportId: string, data: Buffer): Promise<string> {
  const key = `${orgId}/exports/${exportId}.xlsx`;
  await storeFile(key, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return key;
}
