import { AppError } from '../errors';

/** La clé doit appartenir au périmètre du tenant (préfixe `{orgId}/`). */
export function assertStorageKeyInTenant(storageKey: string, tenantId: string): void {
  if (!storageKey.startsWith(`${tenantId}/`)) {
    throw new AppError(
      'STORAGE_KEY_TENANT_MISMATCH',
      'Clé de stockage hors du périmètre de votre organisation',
      'مفتاح التخزين خارج نطاق مؤسستك',
      400,
    );
  }
}
