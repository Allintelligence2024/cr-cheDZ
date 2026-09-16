/**
 * G5 (audit 2026-09, lot MFA) — clé de chiffrement au repos des secrets TOTP.
 *
 * L'API lit TOTP_ENCRYPTION_KEY : une clé de 32 octets encodée en hexadécimal
 * (64 caractères) ou base64/base64url, ou une liste « courante,ancienne,... »
 * pour la rotation (la première scelle, toutes déchiffrent). La clé ne protège
 * QUE le secret TOTP au repos — pas les tokens, pas le chiffrement métier
 * existant (ENCRYPTION_KEY).
 *
 * Politique :
 *  - production sans clé valide : démarrage REFUSÉ (le secret base32 ne doit
 *    plus dormir en clair dans users.totp_secret) ;
 *  - clé présente mais malformée : signalée partout (l'API lève au boot, la
 *    garde production aussi) — pas de repli silencieux sur le clair ;
 *  - test/dev sans clé : mode historique explicite (stockage en clair),
 *    documenté dans la suite phase54.
 */
import type { EnvLike } from './index';

export const TOTP_ENCRYPTION_KEY_ENV = 'TOTP_ENCRYPTION_KEY';

const KEY_HEX64 = /^[0-9a-fA-F]{64}$/;
const KEY_B64_32 = /^[A-Za-z0-9+/]{43}={0,1}$|^[A-Za-z0-9+_-]{43}$/;

function entryValid(entry: string): boolean {
  if (KEY_HEX64.test(entry)) return true;
  if (!KEY_B64_32.test(entry)) return false;
  const buf = Buffer.from(entry.replace(/=+$/, ''), entry.includes('-') || entry.includes('_') ? 'base64url' : 'base64');
  return buf.length === 32;
}

/** Entrées de la liste ; jamais le contenu des clés dans les messages. */
function invalidEntryIndexes(raw: string): number[] {
  const bad: number[] = [];
  raw.split(',').forEach((entry, index) => {
    const value = entry.trim();
    if (value === '') return;
    if (!entryValid(value)) bad.push(index + 1);
  });
  return bad;
}

export function validateTotpEncryptionKey(env: EnvLike = process.env): string[] {
  const raw = env[TOTP_ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.trim() === '') return []; // l'absence n'est bloquante qu'en production (ci-dessous)
  const bad = invalidEntryIndexes(raw);
  if (bad.length === 0) return [];
  return [
    `${TOTP_ENCRYPTION_KEY_ENV}: entrée(s) invalide(s) n° ${bad.join(', ')} — chaque clé doit faire exactement ` +
      '32 octets encodés en hexadécimal (64 caractères) ou base64/base64url ; format de liste : « courante,ancienne » (rotation)',
  ];
}

/** Ajout à la garde production : présence exigée + format valide. */
export function validateTotpEncryptionKeyProduction(env: EnvLike = process.env): string[] {
  const raw = env[TOTP_ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.trim() === '') {
    return [
      `${TOTP_ENCRYPTION_KEY_ENV}: absent — en production le secret TOTP est chiffré au repos (AES-256-GCM) ; ` +
        'fournir 32 octets en hexadécimal (64 caractères) ou base64, liste « courante,ancienne » tolérée pour rotation',
    ];
  }
  return validateTotpEncryptionKey(env);
}
