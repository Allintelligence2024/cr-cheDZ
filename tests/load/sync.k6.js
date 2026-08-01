/**
 * Load test k6 — Phase 11 (à exécuter avec k6, absent de la sandbox).
 *
 *   k6 run tests/load/sync.k6.js
 *
 * Scénario : 50 itérations d'un lot de 10 opérations de synchronisation
 * offline en parallèle (500 ops sync push) + logins + lecture du fil du jour.
 * Critères : p95 sync push < 2 s, 0 erreur HTTP 5xx.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  iterations: 10,
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const EMAIL = __ENV.K6_EMAIL ?? 'load.director@test.dz';
const PASSWORD = __ENV.K6_PASSWORD ?? 'Password123!';
const CHILD_ID = __ENV.K6_CHILD_ID ?? '';

export function setup() {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'content-type': 'application/json' },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return { token: res.json('access_token') };
}

export default function (data) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${data.token}` };

  // 10 opérations de sync push (check_in pour des enfants du tenant)
  const events = [];
  for (let i = 0; i < 10; i += 1) {
    events.push({
      event_id: `k6-${__VU}-${__ITER}-${i}`,
      device_id: 'load-device',
      command: 'check_in',
      child_id: CHILD_ID,
      occurred_at: new Date().toISOString(),
    });
  }
  const push = http.post(`${BASE}/sync/push`, JSON.stringify({ operations: events }), { headers });
  check(push, {
    'sync push 200': (r) => r.status === 200,
    'toutes les opérations acceptées': (r) => (r.json('results') ?? []).every((x) => x.status === 'accepted'),
  });

  // Fil du jour (lecture chaude)
  if (CHILD_ID) {
    const feed = http.get(`${BASE}/parent/children/${CHILD_ID}/feed`, { headers });
    check(feed, { 'feed 200': (r) => r.status === 200 });
  }
  sleep(0.2);
}
