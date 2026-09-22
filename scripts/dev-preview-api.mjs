/**
 * Faux serveur d'API — APERÇU VISUEL UNIQUEMENT.
 *
 * Sert des données synthétiques pour que l'admin-web soit cliquable dans la
 * preview sans PostgreSQL ni la vraie API NestJS. Aucune authentification
 * réelle : n'importe quel mot de passe est accepté.
 *
 * ⚠️ NE JAMAIS déployer ni importer depuis le code applicatif.
 * Usage :  node scripts/dev-preview-api.mjs   (port 3100 par défaut)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PREVIEW_API_PORT ?? 3100);

const ISO = (d) => d.toISOString().slice(0, 10);
const today = ISO(new Date());

const ME = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'nadia.benali@demo.creche.dz',
  first_name: 'Nadia',
  last_name: 'Benali',
  is_super_admin: false,
  memberships: [
    {
      organization_id: '00000000-0000-4000-8000-0000000000a1',
      organization_name: 'Les Petits Pas',
      role_slug: 'director',
      role_name: 'Directrice',
      site_id: null,
      room_ids: [],
      joined_at: '2026-01-05T08:00:00.000Z',
      permissions: ['*'],
    },
  ],
  current_organization_id: '00000000-0000-4000-8000-0000000000a1',
};

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
  [/^\/auth\/login$/, () => ({ access_token: 'preview-token', refresh_token: 'preview-refresh' })],
  [/^\/auth\/refresh$/, () => ({ access_token: 'preview-token' })],
  [/^\/auth\/logout$/, () => ({ ok: true })],
  [/^\/me$/, () => ME],
  [/^\/dashboard\/summary/, () => DASHBOARD],
  [/^\/rooms/, () => ({ rooms: ROOMS, items: ROOMS })],
  [/^\/sites/, () => ({ sites: [
    { id: 's1', name: 'Hydra', name_fr: 'Hydra', wilaya: 'Alger', address: '12 rue des Oliviers' },
    { id: 's2', name: 'Kouba', name_fr: 'Kouba', wilaya: 'Alger', address: '5 boulevard Central' },
  ] })],
  [/^\/children/, () => ({ children: CHILDREN, items: CHILDREN, total: CHILDREN.length })],
  [/^\/organizations/, () => ({ organizations: [
    { id: ME.memberships[0].organization_id, slug: 'petits-pas', name_fr: 'Les Petits Pas', name_ar: 'روضة الخطوات الصغيرة', wilaya: 'Alger' },
  ] })],
  [/^\/health/, () => ({ status: 'ok', database: 'ok', storage: 'ok', worker: 'ok' })],
];

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
    const hit = routes.find(([re]) => re.test(path));
    const payload = hit ? hit[1]() : { items: [], rows: [], data: [] };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[preview-api] données synthétiques sur http://0.0.0.0:${PORT}`);
});
