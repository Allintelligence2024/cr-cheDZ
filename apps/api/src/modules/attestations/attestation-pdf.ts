import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

export interface AttestationPdfData {
  orgName: string;
  orgLegalName?: string | null;
  orgAddress?: string | null;
  orgRegistration?: string | null;
  attestationNumber: string;
  year: number;
  childName: string;
  childBirthDate: string;
  guardianName: string;
  totalInvoiced: number;
  totalPaid: number;
  invoiceCount: number;
  daysPresent: number;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string;
}

const fmt = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, ' ');

/**
 * Attestation annuelle de frais de garde — PDF bilingue FR/AR (pdfkit,
 * police Noto Naskh Arabic embarquée comme pour les factures du worker).
 * Générée à la demande depuis la photo figée en base : deux téléchargements
 * du même document produisent les mêmes chiffres.
 */
export function buildAttestationPdf(d: AttestationPdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true });
    const fontsDir = join(dirname(require.resolve('@embedpdf/fonts-arabic')), '..', 'fonts');
    doc.registerFont('Arabic', join(fontsDir, 'NotoNaskhArabic-Regular.ttf'));
    doc.registerFont('Arabic-Bold', join(fontsDir, 'NotoNaskhArabic-Bold.ttf'));
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // En-tête établissement
    doc.font('Helvetica-Bold').fontSize(12).text(d.orgLegalName || d.orgName);
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    if (d.orgLegalName && d.orgLegalName !== d.orgName) doc.text(d.orgName);
    if (d.orgAddress) doc.text(d.orgAddress);
    if (d.orgRegistration) doc.text(`Agrément / immatriculation : ${d.orgRegistration}`);
    doc.fillColor('#000000').moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(18).text('ATTESTATION DE FRAIS DE GARDE', { align: 'center' });
    doc.font('Arabic-Bold').fontSize(15).text('شهادة مصاريف الحضانة', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#444444')
      .text(`N° ${d.attestationNumber} — Année ${d.year}`, { align: 'center' })
      .fillColor('#000000').moveDown(1.2);

    doc.font('Helvetica').fontSize(10.5);
    doc.text(`Je soussigné(e), représentant(e) de l'établissement ${d.orgLegalName || d.orgName}, atteste que l'enfant :`, { align: 'justify' });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text(`${d.childName}`, { indent: 24 });
    doc.font('Helvetica').text(`né(e) le ${d.childBirthDate}`, { indent: 24 });
    doc.moveDown(0.5);
    const periodTxt = d.periodStart && d.periodEnd ? `du ${d.periodStart} au ${d.periodEnd}` : `au cours de l'année ${d.year}`;
    doc.text(`a été accueilli(e) dans notre établissement ${periodTxt}, et que les frais de garde correspondants, facturés à ${d.guardianName}, s'établissent comme suit :`, { align: 'justify' });
    doc.moveDown(0.8);

    const rows: Array<[string, string]> = [
      ['Nombre de factures émises', String(d.invoiceCount)],
      ['Montant total facturé', `${fmt(d.totalInvoiced)} DZD`],
      ['Montant total réglé', `${fmt(d.totalPaid)} DZD`],
      ['Reste dû au jour de l\'émission', `${fmt(Math.max(0, d.totalInvoiced - d.totalPaid))} DZD`],
      ['Jours de présence enregistrés', String(d.daysPresent)],
    ];
    const x0 = 72, x1 = 360, w1 = 170;
    doc.moveTo(x0 - 8, doc.y).lineTo(x1 + w1 + 8, doc.y).strokeColor('#8B8B8B').lineWidth(0.6).stroke();
    doc.moveDown(0.4);
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font('Helvetica').text(label, x0, y);
      doc.font('Helvetica-Bold').text(value, x1, y, { width: w1, align: 'right' });
      doc.moveDown(0.35);
    }
    doc.moveTo(x0 - 8, doc.y).lineTo(x1 + w1 + 8, doc.y).strokeColor('#8B8B8B').lineWidth(0.6).stroke();
    doc.x = 56;
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10.5)
      .text('La présente attestation est délivrée à la demande de l\'intéressé(e) pour servir et valoir ce que de droit. Elle reflète la situation comptable à sa date d\'émission.', { align: 'justify' });
    doc.moveDown(1);

    // Bloc arabe. Noto Naskh Arabic ne contient pas de glyphes latins : les
    // noms, dates et montants (caractères latins / chiffres) sont rendus sur
    // des lignes séparées en Helvetica, jamais mélangés dans une ligne RTL
    // (sinon boîtes et ordre inversé des chiffres).
    const ar = (t: string) => doc.font('Arabic').fontSize(11).text(t, { align: 'right', features: ['rtla'] });
    const arValue = (label: string, value: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).text(value, 56, y, { width: 260, align: 'left' });
      doc.font('Arabic').fontSize(11).text(label, 316, y, { width: 228, align: 'right', features: ['rtla'] });
      doc.x = 56;
    };
    ar('نشهد بأن الطفل المذكور أدناه قد استُقبل في مؤسستنا خلال السنة المبينة، وأن مصاريف الحضانة المفوترة والمسددة هي كما يلي:');
    doc.moveDown(0.3);
    arValue('الطفل', d.childName);
    arValue('تاريخ الميلاد', d.childBirthDate);
    arValue('السنة', String(d.year));
    arValue('المبلغ المفوتر', `${fmt(d.totalInvoiced)} DZD`);
    arValue('المبلغ المسدد', `${fmt(d.totalPaid)} DZD`);
    arValue('أيام الحضور', String(d.daysPresent));
    doc.moveDown(0.3);
    ar('سُلِّمت هذه الشهادة بطلب من المعني للاستعمال فيما يخوله القانون.');
    doc.moveDown(2);

    doc.font('Helvetica').fontSize(10).text(`Fait le ${d.issuedAt}`, { align: 'right' });
    doc.moveDown(0.3).text('Signature et cachet de l\'établissement', { align: 'right' });
    doc.moveDown(3);
    doc.fontSize(8).fillColor('#666666')
      .text(`Document n° ${d.attestationNumber} — généré par le logiciel de gestion de crèche (DZ). Toute modification manuscrite le rend nul ; une nouvelle attestation peut être émise par l'établissement.`, { align: 'center' });
    doc.end();
  });
}
