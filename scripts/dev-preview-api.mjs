/**
 * Faux serveur d'API — APERÇU VISUEL UNIQUEMENT.
 *
 * Sert des données synthétiques pour que l'admin-web soit cliquable dans la
 * preview sans PostgreSQL ni la vraie API NestJS. Aucune authentification
 * réelle : n'importe quel mot de passe est accepté, l'e-mail choisit le RÔLE.
 *
 * Comptes de démonstration (un par rôle admin-web — miroir de l'invite
 * affichée par le LoginPage en mode VITE_PREVIEW_DEMO=1) :
 *   superadmin@demo.creche.dz    super_admin   (plateforme, /organizations)
 *   nadia.benali@demo.creche.dz  director
 *   amina.haddad@demo.creche.dz  educator
 *   karim.boudiaf@demo.creche.dz accountant
 *   sara.meziane@demo.creche.dz  receptionist
 * Les rôles parent_primary / parent_secondary n'ont AUCUN écran web
 * (application mobile parent) : aucun compte ici.
 *
 * Session : access token `preview-token:<slug>` (Authorization: Bearer) et
 * cookie de refresh `creche_refresh` (Path=/api/v1/auth — miroir de
 * apps/api/src/shared/auth/auth-cookies.ts). Le refresh sans cookie renvoie
 * 401 comme la vraie API, pour que l'écran de connexion soit atteint.
 *
 * ⚠️ NE JAMAIS déployer ni importer depuis le code applicatif.
 * Usage (deux terminaux) :
 *   npm run preview:api    — ce serveur, port 3100
 *   npm run preview:web    — l'admin-web, proxy /api redirigé vers 3100
 *
 * Le proxy de vite.config.ts vise 3000 (la vraie API NestJS) par défaut :
 * sans API_PROXY_TARGET=http://127.0.0.1:3100, tout appel /api renvoie 500
 * (ECONNREFUSED). C'est ce que fait `npm run preview:web`.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PREVIEW_API_PORT ?? 3100);

const ISO = (d) => d.toISOString().slice(0, 10);
const today = ISO(new Date());

const REFRESH_COOKIE = 'creche_refresh';
const REFRESH_MAX_AGE_S = 7 * 24 * 60 * 60;

/** Un compte de démonstration par rôle — l'e-mail sélectionne le rôle. */
const ACCOUNTS = [
  { slug: 'super_admin', email: 'superadmin@demo.creche.dz', first_name: 'Farid', last_name: 'Cherif', role_name: 'Super Admin Plateforme', is_super_admin: true, id: '00000000-0000-4000-8000-000000000000' },
  { slug: 'director', email: 'nadia.benali@demo.creche.dz', first_name: 'Nadia', last_name: 'Benali', role_name: 'Directrice', is_super_admin: false, id: '00000000-0000-4000-8000-000000000001' },
  { slug: 'educator', email: 'amina.haddad@demo.creche.dz', first_name: 'Amina', last_name: 'Haddad', role_name: 'Éducatrice', is_super_admin: false, id: '00000000-0000-4000-8000-000000000002' },
  { slug: 'accountant', email: 'karim.boudiaf@demo.creche.dz', first_name: 'Karim', last_name: 'Boudiaf', role_name: 'Comptable', is_super_admin: false, id: '00000000-0000-4000-8000-000000000003' },
  { slug: 'receptionist', email: 'sara.meziane@demo.creche.dz', first_name: 'Sara', last_name: 'Meziane', role_name: 'Réception', is_super_admin: false, id: '00000000-0000-4000-8000-000000000004' },
];

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

const profileOf = (account) => ({
  id: account.id,
  email: account.email,
  first_name: account.first_name,
  last_name: account.last_name,
  is_super_admin: account.is_super_admin,
  memberships: [
    {
      organization_id: ORG_ID,
      organization_name: 'Les Petits Pas',
      role_slug: account.slug,
      role_name: account.role_name,
      site_id: null,
      room_ids: [],
      joined_at: '2026-01-05T08:00:00.000Z',
      permissions: account.slug === 'director' || account.is_super_admin ? ['*'] : [],
    },
  ],
  current_organization_id: ORG_ID,
});

const tokenFor = (account) => `preview-token:${account.slug}`;
const accountForToken = (token) => ACCOUNTS.find((a) => token === tokenFor(a)) ?? null;
const accountForEmail = (email) =>
  ACCOUNTS.find((a) => a.email.toLowerCase() === String(email ?? '').trim().toLowerCase()) ?? null;

const readCookie = (req) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === REFRESH_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
};

const refreshCookie = (token) =>
  `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE_S}`;
const clearRefreshCookie = `${REFRESH_COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0`;

const DASHBOARD = {
  date: today,
  rooms: [
    { room_id: 'r1', room_name: 'Pouponnière', site_name: 'Hydra', total_children: 16, present: 12, departed: 1, absent: 3, expected: 0 },
    { room_id: 'r2', room_name: 'Petite section', site_name: 'Hydra', total_children: 20, present: 18, departed: 0, absent: 2, expected: 0 },
    { room_id: 'r3', room_name: 'Moyenne section', site_name: 'Hydra', total_children: 18, present: 18, departed: 0, absent: 0, expected: 0 },
    { room_id: 'r4', room_name: 'Grande section', site_name: 'Hydra', total_children: 23, present: 19, departed: 2, absent: 1, expected: 1 },
    { room_id: 'r5', room_name: 'Périscolaire', site_name: 'Kouba', total_children: 14, present: 9, departed: 3, absent: 1, expected: 1 },
    { room_id: 'r6', room_name: 'Salle de sieste', site_name: 'Kouba', total_children: 17, present: 17, departed: 0, absent: 0, expected: 0 },
  ],
  alerts: {
    children_not_checked_in: [
      { id: 'c1', first_name_fr: 'Nour', last_name_fr: 'Hamdi', room_name: 'Moyenne section' },
      { id: 'c2', first_name_fr: 'Yanis', last_name_fr: 'Meziane', room_name: 'Grande section' },
    ],
    documents_expiring: [
      { id: 'd1', first_name: 'Samira', last_name: 'Mokrani', document_type: 'Certificat médical', expiry_date: '2026-10-04' },
      { id: 'd2', first_name: 'Lamia', last_name: 'Kaci', document_type: 'Attestation de vaccination', expiry_date: '2026-10-11' },
    ],
    unpaid_invoices: [
      { id: 'i1', invoice_number: 'FA-2026-0912', first_name_fr: 'Karim', last_name_fr: 'Bouzid', balance: '96000', due_date: '2026-07-15' },
      { id: 'i2', invoice_number: 'FA-2026-0934', first_name_fr: 'Sofiane', last_name_fr: 'Hamdi', balance: '54000', due_date: '2026-08-08' },
      { id: 'i3', invoice_number: 'FA-2026-0951', first_name_fr: 'Amel', last_name_fr: 'Meziane', balance: '48000', due_date: '2026-08-15' },
    ],
    recent_incidents: [
      { id: 'n1', first_name_fr: 'Amine', last_name_fr: 'Kaci', incident_severity: 'modéré', incident_description: 'Fièvre 38,2 °C — parent prévenu' },
    ],
  },
};

const ROOMS = DASHBOARD.rooms.map((r, i) => ({
  id: r.room_id,
  name_fr: r.room_name,
  name_ar: ['قسم الرضّع', 'القسم الصغير', 'القسم المتوسط', 'القسم الكبير', 'ما بعد المدرسة', 'قاعة القيلولة'][i] ?? '',
  site_id: i < 4 ? 's1' : 's2',
  site_name: r.site_name,
  capacity: r.total_children,
  age_min_months: [3, 18, 24, 36, 48, 3][i],
  age_max_months: [18, 24, 36, 48, 72, 72][i],
}));

const CHILDREN = [
  ['Lina', 'Bouzid', 'Moyenne section', '2024-03-14'],
  ['Amine', 'Kaci', 'Moyenne section', '2024-01-22'],
  ['Nour', 'Hamdi', 'Petite section', '2025-02-08'],
  ['Yanis', 'Meziane', 'Grande section', '2023-05-30'],
  ['Maya', 'Slimani', 'Petite section', '2025-01-17'],
  ['Rayan', 'Tabet', 'Pouponnière', '2025-08-02'],
].map((c, i) => ({
  id: `ch${i + 1}`,
  reference: `ENF-${1000 + i}`,
  first_name_fr: c[0],
  last_name_fr: c[1],
  room_name: c[2],
  birth_date: c[3],
  status: 'active',
}));

const routes = [
  [/^\/dashboard\/summary/, () => DASHBOARD],
  [/^\/rooms/, () => ({ rooms: ROOMS, items: ROOMS })],
  [/^\/sites/, () => ({ sites: [
    { id: 's1', name: 'Hydra', name_fr: 'Hydra', wilaya: 'Alger', address: '12 rue des Oliviers' },
    { id: 's2', name: 'Kouba', name_fr: 'Kouba', wilaya: 'Alger', address: '5 boulevard Central' },
  ] })],
  [/^\/children/, () => ({ children: CHILDREN, items: CHILDREN, total: CHILDREN.length })],
  [/^\/organizations/, () => ({ organizations: [
    { id: ORG_ID, slug: 'petits-pas', name_fr: 'Les Petits Pas', name_ar: 'روضة الخطوات الصغيرة', wilaya: 'Alger' },
  ] })],
  [/^\/health/, () => ({ status: 'ok', database: 'ok', storage: 'ok', worker: 'ok' })],
];

const send = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
};

const unauthorized = (res) =>
  send(res, 401, { code: 'UNAUTHORIZED', message_fr: 'Session invalide', message_ar: 'جلسة غير صالحة' });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/^\/api\/v1/, '');

  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch { json = {}; }

    // ── Authentification multi-rôles (aperçu uniquement) ─────────────
    if (path === '/auth/login') {
      const account = accountForEmail(json.email);
      if (!account) {
        send(res, 401, {
          code: 'INVALID_CREDENTIALS',
          message_fr: 'Email ou mot de passe incorrect',
          message_ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        });
        return;
      }
      const token = tokenFor(account);
      const headers = json.web_client ? { 'set-cookie': refreshCookie(token) } : {};
      send(res, 200, { access_token: token, refresh_token: token, expires_in: 15 * 60 }, headers);
      return;
    }

    if (path === '/auth/refresh') {
      const account = accountForToken(readCookie(req));
      if (!account) { unauthorized(res); return; }
      const token = tokenFor(account);
      send(res, 200, { access_token: token, expires_in: 15 * 60 }, { 'set-cookie': refreshCookie(token) });
      return;
    }

    if (path === '/auth/logout') {
      send(res, 200, { ok: true }, { 'set-cookie': clearRefreshCookie });
      return;
    }

    if (path === '/me') {
      const auth = String(req.headers.authorization ?? '');
      const account = accountForToken(auth.replace(/^Bearer\s+/i, ''));
      if (!account) { unauthorized(res); return; }
      send(res, 200, profileOf(account));
      return;
    }

    // ── Données synthétiques (identiques pour tous les rôles) ─────────
    const hit = routes.find(([re]) => re.test(path));
    const payload = hit ? hit[1]() : { items: [], rows: [], data: [] };
    send(res, 200, payload);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[preview-api] données synthétiques sur http://0.0.0.0:${PORT}`);
  console.log('[preview-api] comptes de démonstration (mot de passe libre) :');
  for (const a of ACCOUNTS) console.log(`  ${a.email}  →  ${a.slug}`);
});
