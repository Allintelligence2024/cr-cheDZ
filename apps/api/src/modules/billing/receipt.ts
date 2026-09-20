import { createHash } from 'node:crypto';

/**
 * B4 (audit 2026-09-19) : sel court et stable des numéros de reçu.
 *
 * Avant : `REC-<séquence>-<8 premiers caractères de l'UUID du tenant>` —
 * l'UUID en clair était exposé sur les reçus (papier/email).
 * Maintenant : SHA-256 de l'UUID tronqué à 8 hexadécimaux — stable, distinct
 * par tenant, et non réversible vers l'UUID.
 */
export function receiptSalt(orgId: string): string {
  return createHash('sha256').update(orgId).digest('hex').slice(0, 8);
}

export function buildReceiptNumber(seq: number, orgId: string): string {
  return `REC-${seq}-${receiptSalt(orgId)}`;
}
