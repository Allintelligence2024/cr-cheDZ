import { Errors } from '../errors';
import type { Pool } from 'pg';

/**
 * G4 (audit 2026-09) : révocabilité globale des principaux.
 *
 * Les access tokens portent désormais un claim `epoch` (entier =
 * users.token_epoch, migration 062). Toute écriture révocatoire (statut,
 * super-adminité, mot de passe, suppression douce, memberships,
 * role_assignments) incrémente le compteur — par déclencheur DB, donc y
 * compris pour les opérations SQL directes d'exploitation. Les gardes
 * d'entrée comparent l'époque du token à l'époque courante : une révocation
 * frappe toutes les routes immédiatement, sans attendre l'expiration JWT.
 *
 * Tolérance de déploiement progressif : un token sans claim epoch vaut 0 ;
 * les comptes jamais révoqués sont à 0 → les instances anciennes coexistent
 * avec les nouvelles jusqu'à la première révocation de l'utilisateur.
 *
 * La lecture passe par `auth_principal_epoch(uuid)` (SECURITY DEFINER, même
 * autorité que auth_get_memberships de la 015). Si la fonction est absente
 * (déploiement applicatif avant la migration — erreur d'ordre, pas un état
 * supporté), on retombe sur une lecture directe de la colonne, qui ne peut
 * que REFUSER davantage jamais accorder : mismatch d'époque ⇒ 401.
 */

/** Époque courante du principal, ou null si le compte n'existe plus / est supprimé. */
export async function readPrincipalEpoch(pool: Pool, sub: unknown): Promise<number | null> {
  if (typeof sub !== 'string' || sub.length === 0) return null;
  try {
    const res = await pool.query<{ auth_principal_epoch: string | null }>(
      'SELECT auth_principal_epoch($1) AS auth_principal_epoch',
      [sub],
    );
    const value = res.rows[0]?.auth_principal_epoch;
    return value === null || value === undefined ? null : Number(value);
  } catch (error) {
    // 42883 = fonction inexistante : filet de l'ordre de déploiement.
    if ((error as { code?: string })?.code === '42883') {
      const res = await pool.query<{ token_epoch: string | null }>(
        'SELECT token_epoch FROM users WHERE id = $1 AND deleted_at IS NULL',
        [sub],
      );
      const value = res.rows[0]?.token_epoch;
      return value === null || value === undefined ? null : Number(value);
    }
    throw error;
  }
}

/** Claim `epoch` du token (absent = 0, convention rolling deploy) vs époque courante. */
export function principalEpochMatches(payloadEpoch: unknown, currentEpoch: number | null): boolean {
  if (currentEpoch === null || !Number.isFinite(currentEpoch)) return false;
  const claimed = payloadEpoch === undefined || payloadEpoch === null ? 0 : Number(payloadEpoch);
  if (!Number.isSafeInteger(claimed) || claimed < 0) return false;
  return claimed === currentEpoch;
}

/** Erreur unique, sans fugue d'information sur la cause (compte vs époque). */
export function unauthorizedRevokedPrincipal(): never {
  throw Errors.unauthorized();
}
