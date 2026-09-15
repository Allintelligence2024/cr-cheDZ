/** One selection policy for validation, API readers and worker writers.
 * Production requires an explicit backend; non-production keeps the historical
 * s3 default. Typos/blank values never silently choose a different backend.
 */
export type StorageBackend = 'local' | 's3';
export function resolveStorageBackend(env: { STORAGE_BACKEND?: string; NODE_ENV?: string } = process.env): StorageBackend {
  const value = env.STORAGE_BACKEND;
  if (value === undefined && env.NODE_ENV !== 'production') return 's3';
  if (value === 'local' || value === 's3') return value;
  // Name the variable, never echo arbitrary supplied values or credentials.
  throw new Error('STORAGE_BACKEND: valeur explicite local ou s3 requise (défaut s3 hors production uniquement)');
}
