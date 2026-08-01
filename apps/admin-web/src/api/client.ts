/**
 * Client API : fetch + JWT + refresh rotatif automatique.
 * Les jetons sont stockés en localStorage (MVP web ; cookies httpOnly
 * à évaluer en durcissement Phase 11).
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
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const body = await res.json();
  setTokens(body.access_token, body.refresh_token);
  return body.access_token as string;
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const { access } = getTokens();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(access ? { authorization: `Bearer ${access}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    refreshing ??= refreshAccess();
    const newAccess = await refreshing;
    refreshing = null;
    if (newAccess) return api<T>(method, path, body, false);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message_fr ?? 'Erreur',
      err?.message_ar ?? 'خطأ',
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T = any>(path: string) => api<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => api<T>('POST', path, body),
  patch: <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body),
  del: <T = any>(path: string) => api<T>('DELETE', path),
};
