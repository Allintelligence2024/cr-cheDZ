/**
 * Client API : fetch + JWT + refresh rotatif automatique.
 *
 * R14 (remédiation 2026-09-21, F12) — l'access token reste en mémoire
 * (state React) car il est court (15 min) ; le refresh token est désormais
 * dans un cookie httpOnly positionné par l'API (cf. shared/auth/auth-cookies).
 * Plus de localStorage pour le refresh : un XSS ne peut plus exfiltrer la
 * session. L'API lit le cookie automatiquement sur /auth/refresh.
 *
 * L'access token est gardé en mémoire (variable d'état) et disparaît au
 * reload F5 — comportement attendu : l'utilisateur doit re-login après un
 * F5 si sa session a expiré (le cookie httpOnly + le refresh transparent
 * rendent l'expérience transparente tant que la session de 7j est valide).
 *
 * A2 (remédiation audits combinés) : le single-flight de refresh est
 * nettoyé dans un `finally` — une erreur réseau ne peut plus laisser une
 * promesse rejetée empoisonner `refreshing` et casser toutes les requêtes
 * suivantes. La session n'est détruite QUE si le refresh token est
 * réellement refusé (400/401) : un rate-limit (429) ou une erreur serveur
 * (5xx) conserve les jetons et se retente plus tard.
 */
const BASE = '/api/v1';
const ACCESS_KEY = 'creche_access_token'; // mémoire seulement (cf. ci-dessus)

/** Garde l'access token en mémoire : survit aux re-renders, meurt au reload. */
let accessTokenMemory: string | null = null;

export function getAccessToken(): string | null {
  return accessTokenMemory ?? (typeof window !== 'undefined' ? sessionStorage.getItem(ACCESS_KEY) : null);
}

export function setAccessToken(access: string): void {
  accessTokenMemory = access;
  if (typeof window !== 'undefined') sessionStorage.setItem(ACCESS_KEY, access);
}

export function clearTokens(): void {
  accessTokenMemory = null;
  if (typeof window !== 'undefined') sessionStorage.removeItem(ACCESS_KEY);
  // Note : pas de clear localStorage pour le refresh — il n'y est plus
  // (R14). On laisse le cookie httpOnly être effacé par /auth/logout côté
  // serveur (cf. clearRefreshCookie).
}

/**
 * Wrapper fetch : envoie cookies + Authorization Bearer si access token
 * connu. Le cookie httpOnly est envoyé automatiquement par le navigateur
 * si l'origine est la même (SameSite=Lax + path=/api/v1/auth).
 */
async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const access = getAccessToken();
  return fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include', // R14 : envoyer le cookie httpOnly au serveur
    headers: {
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly messageFr: string,
    public readonly messageAr: string,
  ) {
    super(messageFr);
  }
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  // R14 : on ne fournit PLUS le refresh_token dans le body — l'API lit
  // le cookie httpOnly positionné à /login. Si le navigateur n'envoie
  // pas le cookie (cross-origin, désactivé), le serveur renvoie 401 et
  // la session est considérée comme expirée → redirection login.
  let res: Response;
  try {
    res = await authFetch(`/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {
    // Coupure réseau : ne jamais détruire la session, on retentera.
    return null;
  }
  if (!res.ok) {
    // 400/401 : cookie absent / expiré / révoqué → fin de session.
    // 429 (rate-limit) / 5xx : le cookie reste valide, on garde la session.
    if (res.status === 400 || res.status === 401) clearTokens();
    return null;
  }
  const body = await res.json();
  setAccessToken(body.access_token);
  return body.access_token as string;
}

/** Single-flight : un seul refresh en vol, nettoyage garanti par finally. */
async function singleFlightRefresh(): Promise<string | null> {
  refreshing ??= refreshAccess();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

/**
 * fetch authentifié : si le serveur répond 401 et qu'un retry est autorisé,
 * renouvelle le token une fois puis rejoue la requête. Retourne la réponse
 * brute (JSON ou blob selon l'appelant).
 */
async function authenticatedFetch(path: string, init: RequestInit, retry: boolean): Promise<Response> {
  // R14 : authFetch envoie déjà Authorization Bearer + cookies httpOnly.
  const res = await authFetch(path, init);
  if (res.status === 401 && retry) {
    const newAccess = await singleFlightRefresh();
    if (newAccess) return authenticatedFetch(path, init, false);
  }
  return res;
}

async function toApiError(res: Response): Promise<ApiError> {
  const err = await res.json().catch(() => null);
  return new ApiError(
    res.status,
    err?.code ?? 'INTERNAL_ERROR',
    err?.message_fr ?? 'Erreur',
    err?.message_ar ?? 'خطأ',
  );
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const res = await authenticatedFetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, retry);

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Téléchargement binaire authentifié (A3) : même renouvellement automatique
 * du token que `api()` — plus de 401 sec après expiration des 15 minutes
 * de l'access token.
 *
 * LOT 2 (P0 F5) : l'API ne rend plus d'URL signée S3 à suivre ; le fichier
 * est servi par l'API elle-même, same-origin, et exige l'en-tête
 * `Authorization` (le garde JWT n'accepte QUE le Bearer — le cookie httpOnly
 * ne sert qu'au refresh). D'où le passage par `fetch` + blob plutôt qu'un
 * `window.open` sur une URL nue, qui partirait sans en-tête et recevrait 401.
 */
export async function apiDownload(path: string, retry = true): Promise<Blob> {
  const res = await authenticatedFetch(path, { method: 'GET' }, retry);
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

/**
 * Ouvre un contenu authentifié dans un nouvel onglet (photos, clips, PDF).
 *
 * Le blob est révoqué après 60 s : assez pour que le nouvel onglet charge
 * l'objet: URL, sans fuite mémoire durable. À noter (limite connue,
 * documentée au plan) : le contenu transite en mémoire — acceptable pour des
 * photos/PDF, à surveiller pour de gros clips vidéo.
 */
export async function apiOpenBlob(path: string): Promise<void> {
  const blob = await apiDownload(path);
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export const http = {
  get: <T = unknown>(path: string) => api<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => api<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => api<T>('DELETE', path),
};
