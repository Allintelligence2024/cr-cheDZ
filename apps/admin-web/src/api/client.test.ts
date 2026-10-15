/**
 * Q7 — invariants de session du client API de l'administration.
 *
 * `client.ts` porte trois décisions de sécurité documentées dans son en-tête
 * (R14 : jeton de rafraîchissement en cookie httpOnly, jamais en localStorage ;
 * A2 : single-flight nettoyé dans un `finally`, un 429/5xx ne déconnecte pas ;
 * LOT 2 / F5 : téléchargement binaire authentifié same-origin). Aucune suite
 * ne les vérifiait : ils pouvaient régresser en silence.
 *
 * Exécuté par node --test (`npm run test:unit --workspace @creche/admin-web`,
 * câblé au job `quality` de la CI).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  ApiError,
  api,
  apiDownload,
  clearTokens,
  getAccessToken,
  http,
  setAccessToken,
} from './client.ts';

type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  credentials?: string;
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

type Harness = { calls: Recorded[]; restore: () => void };

const BASE = '/api/v1';

/** Installe un faux `fetch` : enregistre chaque appel, puis délègue au handler. */
function installFetch(handler: Handler): Harness {
  const calls: Recorded[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' && init.body.length > 0
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : undefined;
    calls.push({ url, method: init.method ?? 'GET', headers, body, credentials: init.credentials });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}

type Stub = { status: number; body?: unknown; raw?: boolean };
type StubRoute = Stub | Stub[] | Error;

const json = (stub: Stub): Response =>
  new Response(stub.body === undefined ? null : stub.raw ? String(stub.body) : JSON.stringify(stub.body), {
    status: stub.status,
    headers: stub.body === undefined || stub.raw ? undefined : { 'content-type': 'application/json' },
  });

/**
 * Table de routes (chemin sans préfixe) → réponse, ou liste de réponses
 * successives puis la dernière en boucle : de quoi décrire un 401 suivi du
 * succès rejoué après rafraîchissement.
 */
function withFetch(routes: Record<string, StubRoute>): Harness {
  const queues = new Map<string, (Stub | Error)[]>();
  for (const [path, value] of Object.entries(routes)) {
    queues.set(path, Array.isArray(value) ? [...value] : [value]);
  }
  const harness = installFetch((url) => {
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const queue = queues.get(path) ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error(`route non préparée dans le faux fetch : ${path}`);
    if (next instanceof Error) throw next;
    return json(next);
  });
  return harness;
}

const refreshAccepted = { status: 200, body: { access_token: 'fresh-token' } };
const expired = { status: 401, body: { code: 'TOKEN_EXPIRED', message_fr: 'expiré' } };

let harness: Harness | null = null;

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

test('route préfixée, cookies same-origin et Bearer : ce que le client envoie réellement', async () => {
  harness = withFetch({ '/children': { status: 200, body: { data: [1] } } });
  setAccessToken('access-1');

  assert.deepEqual(await api<{ data: number[] }>('GET', '/children'), { data: [1] });

  const [call] = harness.calls;
  assert.equal(call.url, `${BASE}/children`, 'tout passe par le préfixe versionné');
  assert.equal(call.credentials, 'include', 'R14 : le cookie httpOnly doit être envoyé');
  assert.equal(call.headers.authorization, 'Bearer access-1');
});

test('sans jeton connu, aucune en-tête Authorization inventée', async () => {
  harness = withFetch({ '/auth/me': { status: 200, body: { ok: true } } });
  await http.get('/auth/me');
  assert.equal(harness.calls[0].headers.authorization, undefined);
});

test('un 204 se rend undefined au lieu d’un JSON inexistant', async () => {
  harness = withFetch({ '/children/7/media': { status: 204 } });
  assert.equal(await http.del('/children/7/media'), undefined);
});

test('les erreurs transportent code + message FR et AR (bilinguisme de bout en bout)', async () => {
  harness = withFetch({
    '/billing/invoices': {
      status: 422,
      body: {
        code: 'CASH_OPEN_PREVIOUS_DAY',
        message_fr: 'Caisse ouverte la veille',
        message_ar: 'الصندوق مفتوح من اليوم السابق',
      },
    },
  });
  await assert.rejects(
    () => http.post('/billing/invoices', { amount: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      const apiError = error as ApiError;
      assert.equal(apiError.status, 422);
      assert.equal(apiError.code, 'CASH_OPEN_PREVIOUS_DAY');
      assert.equal(apiError.messageFr, 'Caisse ouverte la veille');
      assert.equal(apiError.messageAr, 'الصندوق مفتوح من اليوم السابق');
      return true;
    },
  );
});

test('une réponse d’erreur non-JSON (proxy, 502 HTML) ne fait pas exploser le client', async () => {
  harness = withFetch({
    '/exports/xlsx': { status: 502, raw: true, body: '<html>502 Bad Gateway</html>' },
  });
  await assert.rejects(
    () => http.get('/exports/xlsx'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal((error as ApiError).code, 'INTERNAL_ERROR');
      assert.equal((error as ApiError).messageFr, 'Erreur');
      assert.ok((error as ApiError).messageAr.length > 0, 'le message AR reste rendu en interface arabe');
      return true;
    },
  );
});

test('401 : jeton renouvelé une fois, requête rejouée avec le nouveau jeton', async () => {
  harness = withFetch({
    '/children': [expired, { status: 200, body: { ok: true } }],
    '/auth/refresh': refreshAccepted,
  });
  setAccessToken('stale');

  assert.deepEqual(await http.get('/children'), { ok: true });
  assert.deepEqual(
    harness.calls.map((call) => call.url),
    [`${BASE}/children`, `${BASE}/auth/refresh`, `${BASE}/children`],
  );
  assert.deepEqual(
    harness.calls[1].body,
    {},
    'R14 : le refresh token n’est plus dans le body, seul le cookie compte',
  );
  assert.equal(harness.calls[2].headers.authorization, 'Bearer fresh-token');
  assert.equal(getAccessToken(), 'fresh-token');
});

test('A2 single-flight : dix 401 simultanés déclenchent UN seul rafraîchissement', async () => {
  const firstAttempt = new Set<string>();
  harness = installFetch(async (url) => {
    if (url.endsWith('/auth/refresh')) {
      await new Promise((resolve) => setTimeout(resolve, 25)); // volontairement lent
      return json(refreshAccepted);
    }
    if (firstAttempt.has(url)) return json({ status: 200, body: { ok: true } });
    firstAttempt.add(url);
    return json(expired);
  });
  setAccessToken('stale');

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => http.get(`/children/${i}`)));
  assert.deepEqual(results, Array.from({ length: 10 }, () => ({ ok: true })));
  const refreshes = harness.calls.filter((call) => call.url.endsWith('/auth/refresh')).length;
  assert.equal(refreshes, 1, 'un seul rafraîchissement en vol, pas un par requête');
});

test('A2 : un rafraîchissement refusé clôture la session sans empoisonner le cache', async () => {
  harness = withFetch({
    '/children': [expired, { status: 200, body: { ok: true } }],
    '/auth/refresh': { status: 401, body: { code: 'REFRESH_REVOKED', message_fr: 'session révoquée' } },
  });
  setAccessToken('stale');

  await assert.rejects(() => http.get('/children'), (error: unknown) => (error as ApiError).status === 401);
  assert.equal(getAccessToken(), null, 'le refus du cookie de refresh clôt la session');

  // Le `finally` doit avoir libéré le créneau, sinon plus AUCUNE requête de la
  // page ne repartirait après un re-login : c'est exactement le défaut d'origine.
  harness.restore();
  harness = withFetch({ '/children': { status: 200, body: { ok: true } } });
  setAccessToken('after-login');
  assert.deepEqual(await http.get('/children'), { ok: true });
});

test('A2 : rate-limit (429) ou panne (5xx) du rafraîchissement conserve les jetons', async () => {
  for (const status of [429, 503]) {
    harness = withFetch({
      '/children': [expired, { status: 200, body: { ok: true } }],
      '/auth/refresh': { status, body: { code: 'RATE_LIMITED', message_fr: 'trop de tentatives' } },
    });
    setAccessToken('stale');

    await assert.rejects(() => http.get('/children'), (error: unknown) => (error as ApiError).status === 401);
    assert.equal(getAccessToken(), 'stale', `un ${status} ne doit pas déconnecter l’utilisatrice`);
    harness.restore();
  }
});

test('coupure réseau pendant le rafraîchissement : session conservée, pas de boucle de rejeu', async () => {
  harness = withFetch({
    '/children': expired,
    '/auth/refresh': new Error('ECONNRESET'),
  });
  setAccessToken('stale');

  await assert.rejects(() => http.get('/children'), (error: unknown) => (error as ApiError).status === 401);
  assert.equal(getAccessToken(), 'stale');
  assert.equal(harness.calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1);
});

test('retry=false : pas de rafraîchissement depuis l’appel qui affiche déjà l’erreur', async () => {
  harness = withFetch({
    '/children': expired,
    '/auth/refresh': refreshAccepted,
  });
  setAccessToken('stale');

  await assert.rejects(() => api('GET', '/children', undefined, false));
  assert.equal(harness.calls.length, 1, 'ni rafraîchissement ni rejouage quand le retry est désactivé');
});

test('LOT 2/F5 : le téléchargement binaire est authentifié et suit le même rafraîchissement', async () => {
  harness = withFetch({
    '/exports/invoices.xlsx': [expired, { status: 200, body: { octet: 'stream' } }],
    '/auth/refresh': refreshAccepted,
  });
  setAccessToken('stale');

  const blob = await apiDownload('/exports/invoices.xlsx');
  assert.match(blob.type, /application\/json/, 'le corps brut est renvoyé tel que servi');
  assert.equal(harness.calls[2].url, `${BASE}/exports/invoices.xlsx`);
  assert.equal(harness.calls[2].headers.authorization, 'Bearer fresh-token', 'le rejouage porte le jeton frais');
});

test('R14 : aucun jeton ne transite par le web storage (mémoire seule)', async () => {
  // Le module ne doit lire/écrire sessionStorage que si `window` existe ; en
  // Node, l'absence de `window` rendrait un accès direct silencieux. On rend
  // donc les deux stockages bruyants : le test échoue dès qu'une fuite y entre.
  const tripwire = (name: string) =>
    new Proxy({} as Storage, {
      get: () => {
        throw new Error(`${name} ne doit plus être utilisé par le client API (R14)`);
      },
    });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['sessionStorage', 'localStorage'] as const) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: tripwire(name), configurable: true });
  }
  harness = withFetch({
    '/children': { status: 200, body: { ok: true } },
    '/auth/refresh': refreshAccepted,
  });
  try {
    setAccessToken('access-1');
    assert.deepEqual(await http.get('/children'), { ok: true });
    setAccessToken('access-2');
    clearTokens();
    assert.equal(getAccessToken(), null);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
