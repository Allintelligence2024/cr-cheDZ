/**
 * G5 (audit 2026-09, lot MFA) — chiffrement au repos du secret TOTP.
 *
 * Le secret base32 n'est plus jamais stocké en clair quand une clé est
 * active : il est scellé AES-256-GCM au format
 *   v1gcm.<iv base64url>.<tag base64url>.<ciphertext base64url>
 * avec l'identifiant utilisateur en AAD — un scellé arraché d'une ligne et
 * collé sur une autre ne se déchiffre pas (anti-relaison entre comptes).
 *
 * Clés (env TOTP_ENCRYPTION_KEY) : liste séparée par des virgules, format
 * hexadécimal 64 caractères ou base64/base64url de 32 octets. La PREMIÈRE
 * clé scelle ; TOUTES les clés déchiffrent → rotation « nouvelle,ancienne »
 * sans interruption, rescellage à la courante au premier usage.
 *
 * Fail-closed : une valeur scellée indéchiffrable (clé retirée, octet
 * altéré, AAD croisé) n'est JAMAIS traitée comme « sans facteur » ; l'appel
 * refus la connexion (403 MFA_SECRET_UNREADABLE côté auth.service).
 *
 * Compatibilité : sans clé active (test/dev ou déploiement pré-G5), le
 * stockage historique en clair reste accepté et produit ; les lignes legacy
 * en clair lues avec une clé active sont rescellées à l'usage (upgrade-on-use).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const TOTP_ENCRYPTION_KEY_ENV = 'TOTP_ENCRYPTION_KEY';
export const TOTP_SEAL_PREFIX = 'v1gcm.';

export interface TotpKeyRing {
  /** Clé courante : celle qui scelle les nouveaux écrits. */
  readonly encryptKey: Buffer;
  /** Courante en premier, puis les anciennes tolérées au déchiffrement. */
  readonly keys: readonly Buffer[];
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

function parseKeyMaterial(entry: string): Buffer {
  if (HEX64.test(entry)) return Buffer.from(entry, 'hex');
  // base64 canonique (avec ou sans padding) ou base64url de 32 octets exacts.
  const compact = entry.replace(/=+$/, '');
  if (/^[A-Za-z0-9+/]{43}$/.test(compact) || /^[A-Za-z0-9+/-_]{43}$/.test(compact)) {
    const buf = Buffer.from(compact, compact.includes('-') || compact.includes('_') ? 'base64url' : 'base64');
    if (buf.length === 32) return buf;
  }
  throw new Error(
    `${TOTP_ENCRYPTION_KEY_ENV}: chaque clé doit faire exactement 32 octets ` +
      '(64 caractères hexadécimaux, ou base64/base64url de 32 octets) — liste « courante,ancienne,... »',
  );
}

/** Clé absente/vide => null (mode historique sans chiffrement). Clé malformée => throw (boot refusé). */
export function parseTotpKeyRing(raw: string | undefined | null): TotpKeyRing | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const entries = trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const keys = entries.map(parseKeyMaterial);
  return { encryptKey: keys[0], keys };
}

export function isSealedTotpSecret(stored: string): boolean {
  return stored.startsWith(TOTP_SEAL_PREFIX);
}

export function sealTotpSecret(ring: TotpKeyRing, userId: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ring.encryptKey, iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${TOTP_SEAL_PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export interface OpenedTotpSecret {
  secret: string;
  /** true si la valeur stockée doit être rescellée à la clé courante (legacy clair ou ancienne clé). */
  needsReseal: boolean;
}

/**
 * Ouvre la valeur stockée. `null` = indéchiffrable/refus (valeur scellée sans
 * clé active, format invalide, tag GCM faux, AAD d'un autre compte). Une
 * valeur en clair est renvoyée telle quelle (legacy), avec needsReseal=true
 * seulement si une clé est active.
 */
export function openTotpSecret(ring: TotpKeyRing | null, userId: string, stored: string | null | undefined): OpenedTotpSecret | null {
  if (!stored) return null;
  if (!isSealedTotpSecret(stored)) return { secret: stored, needsReseal: ring !== null };
  const parts = stored.slice(TOTP_SEAL_PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  let iv: Buffer;
  let tag: Buffer;
  let ct: Buffer;
  try {
    iv = Buffer.from(parts[0], 'base64url');
    tag = Buffer.from(parts[1], 'base64url');
    ct = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) return null;
  if (!ring) return null; // scellé sans clé active : fail-closed, pas un contournement
  for (let index = 0; index < ring.keys.length; index += 1) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', ring.keys[index], iv);
      decipher.setAAD(Buffer.from(userId, 'utf8'));
      decipher.setAuthTag(tag);
      const secret = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      if (!secret) return null;
      return { secret, needsReseal: index !== 0 };
    } catch {
      // tag invalide ou AAD croisé sous cette clé : essayer la suivante.
    }
  }
  return null;
}
