/**
 * Masquage des données personnelles dans l'audit (ADR-010).
 * Toute clé sensible est remplacée par "[REDACTED]" — récursif.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'old_password',
  'new_password',
  'totp_secret',
  'refresh_token_hash',
  'refresh_token',
  'fcm_token',
  'national_id',
  'phone',
  'phone_primary',
  'phone_secondary',
  'email',
  'cnas_number',
  'ip_address',
]);

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  return (
    lower.includes('health') ||
    lower.includes('medication') ||
    lower.includes('temperature') ||
    lower.includes('chronic') ||
    lower.includes('token') ||
    lower.includes('secret')
  );
}

export function redact(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  if (isSensitiveKey(key) && (typeof value === 'string' || typeof value === 'number')) {
    return '[REDACTED]';
  }
  return value;
}
