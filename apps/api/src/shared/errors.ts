/**
 * Erreur métier avec messages bilingues (FR/AR) et code machine.
 * Le filtre global (shared/filters/http-exception.filter.ts) transforme
 * cette erreur en corps HTTP : { statusCode, code, message_fr, message_ar, ... }.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageFr: string,
    public readonly messageAr: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(messageFr);
    this.name = 'AppError';
  }
}

/** Erreurs communes — messages FR/AR à réutiliser partout. */
export const Errors = {
  notFound: () =>
    new AppError('NOT_FOUND', 'Ressource introuvable', 'المورد غير موجود', 404),
  unauthorized: () =>
    new AppError('UNAUTHORIZED', 'Authentification requise', 'مطلوب تسجيل الدخول', 401),
  forbidden: () =>
    new AppError('FORBIDDEN', 'Accès refusé', 'تم رفض الوصول', 403),
  invalidCredentials: () =>
    new AppError(
      'INVALID_CREDENTIALS',
      'Email ou mot de passe incorrect',
      'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      401,
    ),
  accountLocked: (minutes: number) =>
    new AppError(
      'ACCOUNT_LOCKED',
      `Compte temporairement verrouillé. Réessayez dans ${minutes} minutes`,
      `الحساب مقفل مؤقتاً. أعد المحاولة خلال ${minutes} دقائق`,
      423,
    ),
  accountSuspended: () =>
    new AppError('ACCOUNT_SUSPENDED', 'Compte désactivé', 'الحساب معطل', 403),
  totpRequired: () =>
    new AppError('TOTP_REQUIRED', 'Code de vérification requis', 'رمز التحقق مطلوب', 401),
  totpInvalid: () =>
    new AppError('TOTP_INVALID', 'Code de vérification incorrect', 'رمز التحقق غير صحيح', 401),
  sessionReuseDetected: () =>
    new AppError(
      'SESSION_REUSE_DETECTED',
      'Session invalide — reconnectez-vous',
      'جلسة غير صالحة — سجل الدخول من جديد',
      401,
    ),
  sessionExpired: () =>
    new AppError('SESSION_EXPIRED', 'Session expirée — reconnectez-vous', 'انتهت الجلسة — سجل الدخول', 401),
  invalidRefreshToken: () =>
    new AppError('INVALID_REFRESH_TOKEN', 'Jeton de rafraîchissement invalide', 'رمز التحديث غير صالح', 401),
  deviceRevoked: () =>
    new AppError('DEVICE_REVOKED', 'Appareil révoqué — reconnectez-vous', 'تم إلغاء الجهاز — سجل الدخول', 403),
  rateLimited: () =>
    new AppError(
      'RATE_LIMITED',
      'Trop de tentatives. Réessayez plus tard',
      'محاولات كثيرة جداً. أعد المحاولة لاحقاً',
      429,
    ),
  invoiceImmutable: () =>
    new AppError(
      'INVOICE_IMMUTABLE',
      'Une facture payée ou annulée ne peut pas être modifiée',
      'لا يمكن تعديل فاتورة مدفوعة أو ملغاة',
      422,
    ),
} as const;
