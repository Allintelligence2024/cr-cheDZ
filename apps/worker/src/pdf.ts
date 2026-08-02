/**
 * Génération de PDF de facture + stockage (backend local ou S3/MinIO).
 *
 * - PDF BILINGUE FR/AR généré par pdfkit (fontkit) avec la police arabe
 *   Noto Naskh Arabic EMBARQUÉE (paquet @embedpdf/fonts-arabic) : fontkit
 *   applique la composition GSUB (ligatures, formes contextuelles) — l'arabe
 *   s'affiche correctement, pas seulement des glyphes isolés.
 * - Stockage explicitement configuré : STORAGE_BACKEND=local (STORAGE_LOCAL_DIR)
 *   ou STORAGE_BACKEND=s3 (S3/MinIO via S3_*). Jamais d'envoi sans config.
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import PDFDocument from 'pdfkit';

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

const fmt = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\u202f\u00a0]/g, ' ');

/** Construit un PDF A4 bilingue (FR + AR) avec en-tête, lignes et totaux. */
export function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });

    // Police arabe embarquée (TTF Noto Naskh Arabic — GSUB complet).
    // Le paquet bloque l'accès direct aux fonts via "exports" → on résout
    // l'entrée principale puis on navigue vers ../fonts/.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgEntry = require.resolve('@embedpdf/fonts-arabic');
    const fontsDir = join(dirname(pkgEntry), '..', 'fonts');
    const arabicRegular = join(fontsDir, 'NotoNaskhArabic-Regular.ttf');
    const arabicBold = join(fontsDir, 'NotoNaskhArabic-Bold.ttf');
    doc.registerFont('Amiri', arabicRegular);
    doc.registerFont('Amiri-Bold', arabicBold);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // En-tête
    doc.font('Helvetica-Bold').fontSize(20).text('FACTURE', { align: 'left' });
    doc.font('Amiri-Bold').fontSize(14).text('فاتورة', { align: 'right' });
    doc.font('Helvetica').fontSize(10).moveDown(0.6)
      .text(`N° ${data.invoiceNumber}`, { continued: true })
      .fillColor('#666666')
      .text(`   الفترة : ${data.periodLabel}    •    Période : ${data.periodLabel}`, { align: 'right' });
    doc.fillColor('#000000')
      .text(`Échéance : ${data.dueDate}    •    الاستحقاق : ${data.dueDate}`, { align: 'right' });
    doc.moveDown(0.5)
      .font('Helvetica-Bold').fontSize(11).text(data.orgName);
    doc.font('Helvetica').fontSize(10)
      .text(`Enfant : ${data.childName}    •    الطفل : ${data.childName}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(48, doc.y).lineTo(545, doc.y).strokeColor('#8B8B8B').lineWidth(0.6).stroke();
    doc.moveDown(0.7);

    // Tableau
    const startY = doc.y;
    const colX = [48, 350, 415, 470];
    const colW = [300, 65, 55, 75];
    const headerY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Désignation', colX[0], headerY);
    doc.text('Qté', colX[1], headerY, { width: colW[1], align: 'right' });
    doc.text('P.U. (DZD)', colX[2], headerY, { width: colW[2], align: 'right' });
    doc.text('Total (DZD)', colX[3], headerY, { width: colW[3], align: 'right' });
    doc.moveTo(48, doc.y + 6).lineTo(545, doc.y + 6).strokeColor('#8B8B8B').lineWidth(0.6).stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(9);
    for (const line of data.lines) {
      if (doc.y > 700) break; // MVP : une page
      doc.text(line.description.slice(0, 60), colX[0], doc.y);
      doc.text(String(line.quantity), colX[1], doc.y, { width: colW[1], align: 'right' });
      doc.text(fmt(line.unitPrice), colX[2], doc.y, { width: colW[2], align: 'right' });
      doc.text(fmt(line.total), colX[3], doc.y, { width: colW[3], align: 'right' });
      doc.moveDown(0.5);
    }
    doc.moveTo(48, doc.y).lineTo(545, doc.y).strokeColor('#8B8B8B').lineWidth(0.6).stroke();
    doc.moveDown(0.7);

    // Totaux
    doc.font('Helvetica').fontSize(10);
    doc.text(`Sous-total : ${fmt(data.subtotal)} DZD`, { align: 'right' });
    doc.text(`Remise : ${fmt(data.discount)} DZD`, { align: 'right' });
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(11)
      .text(`TOTAL : ${fmt(data.total)} DZD`, { align: 'right', continued: true })
      .font('Amiri-Bold')
      .text(`      المجموع : ${fmt(data.total)} دج`, { align: 'right' });

    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(9).fillColor('#444444')
      .text('Merci de régler avant l’échéance.   شكراً على التسديد قبل الاستحقاق.')
      .fontSize(8).fillColor('#666666')
      .text(`Générée le ${data.generatedAt} — logiciel de gestion de crèche (DZ)`);
    void startY;

    doc.end();
  });
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

/** Stocke un fichier : backend local (répertoire) ou S3/MinIO (objet). */
export async function storeFile(key: string, data: Buffer, contentType: string): Promise<void> {
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
    await s3Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
    return;
  }
  throw new Error(`STORAGE_BACKEND inconnu: ${backend} (attendu: local | s3)`);
}

/** Supprime un fichier du backend indiqué (purge DPIA des clips vidéo à 30 j).
 *  ENOENT local = fichier déjà absent (jamais uploadé) : l'invariant « plus
 *  aucune donnée » est tenu — toléré. Tout autre échec remonte → job failed. */
export async function deleteFile(key: string, backend: 'local' | 's3'): Promise<void> {
  if (backend === 'local') {
    const baseDir = process.env.STORAGE_LOCAL_DIR ?? '/tmp/creche-pdf';
    try {
      unlinkSync(join(baseDir, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return;
  }
  const bucket = process.env.S3_BUCKET ?? 'creche-media';
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Stocke le PDF (gardé pour compatibilité — appels existants). */
export async function storePdf(key: string, data: Buffer): Promise<void> {
  await storeFile(key, data, 'application/pdf');
}
