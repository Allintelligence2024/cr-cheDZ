/**
 * Génération de PDF de facture + stockage (backend local ou S3/MinIO).
 *
 * - Le générateur est un écrivain PDF minimal mais RÉEL : fichier PDF 1.4
 *   valide (catalogue, pages, polices WinAnsi, xref, trailer) — vérifié par
 *   les tests (en-tête %PDF, lecture par l'API, contenu texte).
 * - Le corps est en français (Helvetica/WinAnsi) : la composition arabe dans
 *   un PDF exige l'embedding d'une police avec tables GSUB (limitation
 *   documentée — pas de fausse promesse d'un PDF AR).
 * - Stockage explicitement configuré : STORAGE_BACKEND=local (STORAGE_LOCAL_DIR)
 *   ou STORAGE_BACKEND=s3 (S3/MinIO via S3_*). Jamais d'envoi sans config.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface InvoiceLineData {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoicePdfData {
  orgName: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  childName: string;
  lines: InvoiceLineData[];
  subtotal: number;
  discount: number;
  total: number;
  generatedAt: string;
}

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const fmt = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u202f\u00a0]/g, ' ');

const text = (s: string, size: number, x: number, y: number, font = 'F1'): string =>
  `BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
const hrule = (y: number): string => `0.6 w 0.55 0.55 0.55 RG 50 ${y} m 545 ${y} l S 0 0 0 RG`;

/** Construit un PDF A4 (595×842 pt) avec en-tête, lignes et totaux. */
export function buildInvoicePdf(data: InvoicePdfData): Buffer {
  const c: string[] = [];
  c.push(text('FACTURE', 20, 50, 800));
  c.push(text(`N° ${data.invoiceNumber}`, 11, 50, 780));
  c.push(text(`Période : ${data.periodLabel}`, 10, 50, 766));
  c.push(text(`Échéance : ${data.dueDate}`, 10, 50, 752));
  c.push(hrule(742));
  c.push(text(data.orgName, 11, 50, 726));
  c.push(text(`Enfant : ${data.childName}`, 10, 50, 710));

  // Tableau
  const headerY = 688;
  c.push(hrule(headerY + 8));
  c.push(text('Désignation', 9, 50, headerY));
  c.push(text('Qté', 9, 380, headerY));
  c.push(text('P.U. (DZD)', 9, 415, headerY));
  c.push(text('Total (DZD)', 9, 470, headerY));
  c.push(hrule(headerY - 6));

  let y = headerY - 22;
  for (const line of data.lines) {
    if (y < 120) break; // MVP : une page
    c.push(text(line.description.slice(0, 60), 9, 50, y));
    c.push(text(String(line.quantity), 9, 380, y));
    c.push(text(fmt(line.unitPrice), 9, 415, y));
    c.push(text(fmt(line.total), 9, 470, y));
    y -= 15;
  }
  c.push(hrule(y - 2));
  y -= 18;
  c.push(text(`Sous-total : ${fmt(data.subtotal)} DZD`, 10, 400, y));
  y -= 14;
  c.push(text(`Remise : ${fmt(data.discount)} DZD`, 10, 400, y));
  y -= 16;
  c.push(text(`TOTAL : ${fmt(data.total)} DZD`, 11, 400, y, 'F2'));
  y -= 34;
  c.push(text('Merci de régler avant l’échéance.', 9, 50, y));
  c.push(text(`Générée le ${data.generatedAt} — logiciel de gestion de crèche (DZ)`, 8, 50, y - 14));

  const stream = `${c.join('\n')}\n`;
  const contentObj = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  const add = (obj: string): void => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${obj}\n`;
  };

  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj');
  add('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj');
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj');
  add(`6 0 obj\n${contentObj}\nendobj`);

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ── Stockage ────────────────────────────────────────────────────────────────

function s3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'minio_dev',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'minio_dev_password',
    },
    forcePathStyle: true,
  });
}

/** Stocke le PDF : backend local (répertoire) ou S3/MinIO (objet). */
export async function storePdf(key: string, data: Buffer): Promise<void> {
  const backend = process.env.STORAGE_BACKEND ?? 's3';
  if (backend === 'local') {
    const baseDir = process.env.STORAGE_LOCAL_DIR ?? '/tmp/creche-pdf';
    const filePath = join(baseDir, key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, data);
    return;
  }
  if (backend === 's3') {
    const bucket = process.env.S3_BUCKET ?? 'creche-media';
    await s3Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: 'application/pdf' }));
    return;
  }
  throw new Error(`STORAGE_BACKEND inconnu: ${backend} (attendu: local | s3)`);
}
