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

// Même liste, sans les underscores (`passwordhash`), pour comparer aussi bien
// `passwordHash` (camelCase DTO) que `password_hash` (snake_case SQL).
const NORMALIZED_SENSITIVE = new Set([...SENSITIVE_KEYS].map((k) => k.replace(/_/g, '')));

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Les DTO utilisent camelCase (`passwordHash`, `phonePrimary`,
  // `refreshTokenHash`) et la base snake_case (`password_hash`) : on compare
  // les trois formes, sinon les clés camelCase contournaient le masquage.
  const normalized = lower.replace(/_/g, '');
  const camelNormalized = lower.replace(/_(.)/g, (_, c: string) => c);
  if (SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(camelNormalized) || NORMALIZED_SENSITIVE.has(normalized)) return true;
  return (
    lower.includes('health') ||
    lower.includes('medication') ||
    lower.includes('temperature') ||
    lower.includes('chronic') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password')
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
