/**
 * Helpers cookies pour les clients web (admin-web, support-console).
 *
 * R14 (remédiation 2026-09-21, F12) — sortir les tokens web de
 * localStorage. Le refresh token est désormais positionné par l'API dans
 * un cookie httpOnly + Secure + SameSite=Lax ; le JS client n'y a plus
 * accès, donc un XSS ne peut plus exfiltrer la session.
 *
 * L'access token reste en mémoire (state React) car il est court (15 min)
 * et doit être envoyé en Authorization: Bearer. Le risque XSS sur un token
 * mémoire est limité à la session active ; le refresh, qui peut vivre 7
 * jours, sort de localStorage → cookie httpOnly.
 *
 * Les mobiles (parent-mobile, staff-mobile) ne sont PAS concernés : ils
 * utilisent flutter_secure_storage et Bearer-only. Le flag `web_client`
 * est false par défaut pour eux → aucun cookie positionné.
 */

import type { Response } from 'express';

/** Nom du cookie (préfixé `__Host-` en prod : aucun Domain, Path=/, Secure). */
export const REFRESH_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-creche_refresh' : 'creche_refresh';

/**
 * Chemin du cookie.
 *
 * Correctif (audit 2026-10-02) : le préfixe `__Host-` (RFC 6265bis §4.1.3)
 * EXIGE `Path=/` en plus de `Secure` et de l'absence de `Domain`. Poser
 * `__Host-creche_refresh` avec `Path=/api/v1/auth` faisait REJETER le cookie
 * par tout navigateur conforme : en production, le refresh token n'était
 * jamais stocké et la session web expirait à la première rotation.
 * En dev (nom sans préfixe), on conserve le chemin minimal `/api/v1/auth`.
 */
export const REFRESH_COOKIE_PATH = process.env.NODE_ENV === 'production' ? '/' : '/api/v1/auth';

export interface SetRefreshCookieOptions {
  /** Durée de vie du cookie en secondes (par défaut 7 jours, alignée refresh_token). */
  maxAgeSeconds?: number;
}

/**
 * Positionne le cookie httpOnly contenant le refresh_token. En production :
 * Secure + __Host- prefix + SameSite=Lax (les requêtes cross-site POST
 * envoyant le cookie sont bloquées ; on autorise les GET top-level
 * navigations = liens normaux). En dev : pas de Secure (http://localhost).
 */
export function setRefreshCookie(res: Response, refreshToken: string, opts: SetRefreshCookieOptions = {}): void {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = opts.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    // Prod : `Path=/` imposé par le préfixe `__Host-` (cf. REFRESH_COOKIE_PATH).
    // Dev : cookie limité aux endpoints d'auth — surface minimale.
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAge * 1000,
  });
}

/**
 * Lit le cookie de refresh sur une requête entrante. Retourne `null` si
 * absent (mobile / cookie expiré / client non-web).
 */
export function readRefreshCookie(cookies: Record<string, string | undefined> | undefined): string | null {
  if (!cookies) return null;
  return cookies[REFRESH_COOKIE_NAME] ?? null;
}

/** Efface le cookie (logout, remplacement de session). */
export function clearRefreshCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    // DOIT être identique au chemin de pose, sinon le navigateur ne supprime
    // pas le cookie (et `__Host-` exige `Path=/`, cf. REFRESH_COOKIE_PATH).
    path: REFRESH_COOKIE_PATH,
  });
}
