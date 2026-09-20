/**
 * Templates d'emails transactionnels — bilingues FR/AR (loi 25-11 :
 * information compréhensible pour les deux langues officielles).
 * Aucun secret ne doit apparaître ailleurs que dans le lien destiné au
 * seul destinataire.
 */

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface InvitationTemplateInput {
  orgName: string;
  acceptUrl: string;
}

export function invitationEmail(input: InvitationTemplateInput): { subject: string; html: string; text: string } {
  const org = escapeHtml(input.orgName);
  const url = escapeHtml(input.acceptUrl);
  const subject = `Invitation — ${input.orgName} | Crèche DZ`;
  const html = `<!doctype html>
<html lang="fr"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin-bottom:16px">Invitation à rejoindre Crèche DZ</h1>
  <p>Bonjour,</p>
  <p>La structure <strong>${org}</strong> vous invite à rejoindre la plateforme Crèche DZ.</p>
  <p style="margin:24px 0"><a href="${url}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Accepter l’invitation</a></p>
  <p style="font-size:12px;color:#6b7280">Ce lien est personnel et valable 7 jours. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <div dir="rtl" style="text-align:right">
    <p>مرحباً،</p>
    <p>تدعوكم مؤسسة <strong>${org}</strong> للانضمام إلى منصة «كراش دي زاد».</p>
    <p style="margin:24px 0"><a href="${url}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">قبول الدعوة</a></p>
    <p style="font-size:12px;color:#6b7280">هذا الرابط شخصي وصالح لمدة 7 أيام. إذا لم تكن معنياً بهذه الدعوة، تجاهلوا هذه الرسالة.</p>
  </div>
</body></html>`;
  const text = [
    `Bonjour,`,
    ``,
    `La structure ${input.orgName} vous invite à rejoindre la plateforme Crèche DZ.`,
    `Pour accepter l'invitation (valable 7 jours), ouvrez ce lien :`,
    input.acceptUrl,
    ``,
    `---`,
    `مرحباً،`,
    `تدعوكم مؤسسة ${input.orgName} للانضمام إلى منصة «كرانش دي زاد».`,
    `لقبول الدعوة (صالحة لمدة 7 أيام)، افتحوا هذا الرابط:`,
    input.acceptUrl,
  ].join('\n');
  return { subject, html, text };
}

export interface PaymentReceiptTemplateInput {
  orgName: string;
  receiptNumber: string;
  amount: number;
  method: string;
}

const formatAmount = (amount: number): string =>
  `${new Intl.NumberFormat('fr-DZ', { minimumFractionDigits: 2 }).format(amount)} DZD`;

export function paymentReceiptEmail(input: PaymentReceiptTemplateInput & { to?: string }): { subject: string; html: string; text: string } {
  const org = escapeHtml(input.orgName);
  const receipt = escapeHtml(input.receiptNumber);
  const amount = formatAmount(input.amount);
  const method = escapeHtml(input.method);
  const subject = `Reçu de paiement ${input.receiptNumber} — ${input.orgName}`;
  const html = `<!doctype html>
<html lang="fr"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin-bottom:16px">Reçu de paiement</h1>
  <p>Bonjour,</p>
  <p>Nous confirmons la réception de votre paiement :</p>
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Structure</td><td><strong>${org}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Reçu n°</td><td><strong>${receipt}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Montant</td><td><strong>${amount}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Mode</td><td>${method}</td></tr>
  </table>
  <p style="font-size:12px;color:#6b7280">Ce reçu vaut confirmation d'encaissement. Conservez-le avec vos justificatifs.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <div dir="rtl" style="text-align:right">
    <p>مرحباً، نؤكد استلام دفعتكم :</p>
    <p>رقم الإيصال: <strong>${receipt}</strong> — المبلغ: <strong>${amount}</strong> — المؤسسة: <strong>${org}</strong></p>
    <p style="font-size:12px;color:#6b7280">يعتبر هذا الإيصال تأكيداً للدفع. احتفظوا به مع وثائقكم.</p>
  </div>
</body></html>`;
  const text = [
    `Bonjour,`,
    ``,
    `Nous confirmons la réception de votre paiement :`,
    `  Structure : ${input.orgName}`,
    `  Reçu n°   : ${input.receiptNumber}`,
    `  Montant   : ${amount}`,
    `  Mode      : ${input.method}`,
    ``,
    `---`,
    `نؤكد استلام دفعتكم. رقم الإيصال: ${input.receiptNumber} — المبلغ: ${amount}`,
  ].join('\n');
  return { subject, html, text };
}

export interface InvoiceReminderTemplateInput {
  orgName: string;
  invoiceNumber: string;
  childName: string;
  balanceDue: number;
  dueDate: string; // YYYY-MM-DD
  level: 1 | 2 | 3;
}

const REMINDER_LABELS: Record<1 | 2 | 3, { fr: string; ar: string }> = {
  1: { fr: 'Rappel de paiement', ar: 'تذكير بالدفع' },
  2: { fr: 'Relance de paiement', ar: 'تنبيه بالدفع' },
  3: { fr: 'Dernier rappel avant suspension', ar: 'تذكير أخير قبل التعليق' },
};

/** Relance d'impayé (P2-3) — 3 niveaux, bilingue, aucun secret ni lien signé. */
export function invoiceReminderEmail(input: InvoiceReminderTemplateInput): { subject: string; html: string; text: string } {
  const label = REMINDER_LABELS[input.level];
  const org = escapeHtml(input.orgName);
  const invoice = escapeHtml(input.invoiceNumber);
  const child = escapeHtml(input.childName);
  const amount = formatAmount(input.balanceDue);
  const due = escapeHtml(input.dueDate);
  const subject = `${label.fr} — facture ${input.invoiceNumber} — ${input.orgName}`;
  const html = `<!doctype html>
<html lang="fr"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin-bottom:16px">${escapeHtml(label.fr)}</h1>
  <p>Bonjour,</p>
  <p>Sauf erreur de notre part, la facture ci-dessous reste impayée :</p>
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Structure</td><td><strong>${org}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Enfant</td><td>${child}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Facture n°</td><td><strong>${invoice}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Échéance</td><td>${due}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Solde dû</td><td><strong>${amount}</strong></td></tr>
  </table>
  <p>Merci de régulariser auprès de la structure (espèces, CIB ou Edahabia). Si le règlement a déjà été effectué, veuillez ne pas tenir compte de ce message.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <div dir="rtl" style="text-align:right">
    <h2 style="font-size:18px">${escapeHtml(label.ar)}</h2>
    <p>مرحباً، ما لم يكن هناك خطأ من جهتنا، لا تزال الفاتورة التالية غير مسددة :</p>
    <p>الفاتورة رقم <strong>${invoice}</strong> — الطفل: ${child} — تاريخ الاستحقاق: ${due} — المبلغ المستحق: <strong>${amount}</strong> — المؤسسة: <strong>${org}</strong></p>
    <p>يرجى التسوية لدى المؤسسة. إذا كنتم قد سددتم بالفعل، يرجى تجاهل هذه الرسالة.</p>
  </div>
</body></html>`;
  const text = [
    label.fr,
    ``,
    `Bonjour,`,
    `Sauf erreur de notre part, la facture ci-dessous reste impayée :`,
    `  Structure  : ${input.orgName}`,
    `  Enfant     : ${input.childName}`,
    `  Facture n° : ${input.invoiceNumber}`,
    `  Échéance   : ${input.dueDate}`,
    `  Solde dû   : ${amount}`,
    `Merci de régulariser auprès de la structure. Si le règlement a déjà été effectué, ne tenez pas compte de ce message.`,
    ``,
    `---`,
    `${label.ar} — الفاتورة رقم ${input.invoiceNumber} — المبلغ المستحق: ${amount} — تاريخ الاستحقاق: ${input.dueDate}`,
  ].join('\n');
  return { subject, html, text };
}
