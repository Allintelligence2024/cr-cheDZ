import assert from 'node:assert/strict';

/**
 * Vérification de bout en bout de l'aperçu multi-rôles : chaque compte
 * démo se connecte via le proxy Vite (:4000) et obtient le BON rôle sur /me.
 * Lancer les deux serveurs d'abord :
 *   npm run preview:api   (:3100)
 *   npm run preview:web   (:4000, proxy → 3100)
 *   node scripts/check-preview-roles.mjs
 */
const BASE = process.env.PREVIEW_WEB_URL ?? 'http://127.0.0.1:4000/api/v1';

const EXPECTED = [
  ['superadmin@demo.creche.dz', 'super_admin', true],
  ['nadia.benali@demo.creche.dz', 'director', false],
  ['amina.haddad@demo.creche.dz', 'educator', false],
  ['karim.boudiaf@demo.creche.dz', 'accountant', false],
  ['sara.meziane@demo.creche.dz', 'receptionist', false],
];

const login = async (email) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo', web_client: true }),
  });
  assert.equal(res.status, 200, `login ${email} → ${res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /creche_refresh=/, `cookie de refresh posé pour ${email}`);
  const body = await res.json();
  assert.match(body.access_token, /^preview-token:/, `jeton pour ${email}`);
  return { token: body.access_token, cookie: setCookie.split(';')[0] };
};

const me = async (token) => {
  const res = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, `/me → ${res.status}`);
  return res.json();
};

let pass = 0;
for (const [email, role, isSuper] of EXPECTED) {
  const { token } = await login(email);
  const profile = await me(token);
  assert.equal(profile.memberships[0].role_slug, role, `${email} → rôle ${role}`);
  assert.equal(profile.is_super_admin, isSuper, `${email} → is_super_admin=${isSuper}`);
  assert.equal(profile.email, email, `${email} → /me email`);
  console.log(`  ✓ ${email.padEnd(30)} → ${role}`);
  pass += 1;
}

// Rejet : e-mail inconnu et /me sans jeton doivent rester 401.
const bad = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'inconnu@demo.creche.dz', password: 'x' }),
});
assert.equal(bad.status, 401, 'e-mail inconnu → 401');
const noAuth = await fetch(`${BASE}/me`);
assert.equal(noAuth.status, 401, '/me sans jeton → 401');
const refreshNoCookie = await fetch(`${BASE}/auth/refresh`, { method: 'POST' });
assert.equal(refreshNoCookie.status, 401, 'refresh sans cookie → 401');
console.log('  ✓ rejets (e-mail inconnu, /me sans jeton, refresh sans cookie)');

// Refresh AVEC le cookie renouvelle bien la session.
const { cookie } = await login('amina.haddad@demo.creche.dz');
const refreshed = await fetch(`${BASE}/auth/refresh`, {
  method: 'POST',
  headers: { cookie },
});
assert.equal(refreshed.status, 200, 'refresh avec cookie → 200');
const refreshedBody = await refreshed.json();
assert.equal(refreshedBody.access_token, 'preview-token:educator', 'refresh → même rôle');
console.log('  ✓ refresh avec cookie → 200 (session maintenue)');

// La page HTML du web répond (SPA servie par Vite).
const html = await fetch('http://127.0.0.1:4000/');
assert.equal(html.status, 200, 'SPA web → 200');
console.log('  ✓ SPA admin-web (:4000) → 200');

console.log(`\nOK — ${pass} rôles vérifiés + rejets + refresh + SPA.`);
