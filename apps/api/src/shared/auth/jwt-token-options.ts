import { createHmac } from 'node:crypto';

/**
 * Options JWT partagées — audit 2026-09, finding C4.
 *
 * Deux familles de tokens coexistent :
 *   - access tokens (15 min, secret JWT_SECRET) — acceptés par JwtAuthGuard ;
 *   - invitation tokens (7 j) — acceptés UNIQUEMENT par POST /auth/accept-invitation.
 *
 * Avant ce correctif, les deux familles partageaient le même secret : un token
 * d'invitation était accepté comme token d'accès (activation 2FA sur le compte
 * de la victime avant acceptation, etc.). Deux barrières désormais :
 *   1. JwtAuthGuard exige purpose === 'access' (voir jwt-auth.guard.ts) ;
 *   2. séparation cryptographique : le secret d'invitation est DÉRIVÉ du
 *      JWT_SECRET (HMAC-SHA256), donc distinct sans nouvelle variable d'env.
 */
export const DEFAULT_JWT_SECRET = 'dev_jwt_secret_change_in_prod_minimum_32_chars';

export const ACCESS_TOKEN_PURPOSE = 'access';
export const INVITATION_TOKEN_PURPOSE = 'invitation';

/** Secret d'invitation dérivé du secret maître — aucune nouvelle config requise. */
export function deriveInvitationSecret(masterSecret: string): string {
  return createHmac('sha256', masterSecret).update('creche:invitation-jwt:v1').digest('base64url');
}
