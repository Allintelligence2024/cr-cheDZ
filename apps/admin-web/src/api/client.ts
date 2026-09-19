/**
 * Client API : fetch + JWT + refresh rotatif automatique.
 * Les jetons sont stockés en localStorage (MVP web ; cookies httpOnly
 * à évaluer en durcissement Phase 11).
 *
 * A2 (remédiation audits combinés) : le single-flight de refresh est
 * nettoyé dans un `finally` — une erreur réseau ne peut plus laisser une
 * promesse rejetée empoisonner `refreshing` et casser toutes les requêtes
 * suivantes. La session n'est détruite QUE si le refresh token est
 * réellement refusé (400/401) : un rate-limit (429) ou une erreur serveur
 * (5xx) conserve les jetons et se retente plus tard.
 */
const BASE = '/api/v1';
const ACCESS_KEY = 'creche_access_token';
const REFRESH_KEY = 'creche_refresh_token';

export function getTokens(): { access: string | null; refresh: string | null } {
  return {
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
  };
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
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
  const { refresh } = getTokens();
  if (!refresh) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {
    // Coupure réseau : ne jamais détruire la session, on retentera.
    return null;
  }
  if (!res.ok) {
    // 400/401 : refresh token invalide, réutilisé ou révoqué → fin de session.
    // 429 (rate-limit) / 5xx : le jeton reste valide, on garde la session.
    if (res.status === 400 || res.status === 401) clearTokens();
    return null;
  }
  const body = await res.json();
  setTokens(body.access_token, body.refresh_token);
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
  const { access } = getTokens();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init.headers ?? {}),
    },
  });
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
 * de l'access token. Les redirections (URL signée S3) sont suivies.
 */
export async function apiDownload(path: string, retry = true): Promise<Blob> {
  const res = await authenticatedFetch(path, { method: 'GET', redirect: 'follow' }, retry);
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

export const http = {
  get: <T = unknown>(path: string) => api<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => api<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => api<T>('DELETE', path),
};
