import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** TOTP (RFC 6238) — SHA-1, 6 chiffres, pas de 30 s. Implémentation sans dépendance. */
export class TotpService {
  /** Secret aléatoire (20 octets) encodé en base32 — compatible Google Authenticator. */
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** Code TOTP courant pour un secret. */
  generate(secret: string, counter?: number): string {
    const c = counter ?? Math.floor(Date.now() / STEP_MS);
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(c));
    const hmac = createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS)
      .toString()
      .padStart(DIGITS, '0');
    return code;
  }

  /** Vérification avec fenêtre ±window pas de 30 s (tolère l'horloge). */
  verify(secret: string, token: string, window = 1): boolean {
    if (!/^\d{6}$/.test(token)) return false;
    const current = Math.floor(Date.now() / STEP_MS);
    for (let w = -window; w <= window; w += 1) {
      const expected = this.generate(secret, current + w);
      if (timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return true;
    }
    return false;
  }

  /** URL otpauth:// pour le QR code de Google Authenticator. */
  otpauthUrl(secret: string, account: string, issuer = 'CrecheSaaS'): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(
      issuer,
    )}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_MS / 1000}`;
  }
}
