#!/usr/bin/env node
/**
 * Phase 59 GATE — P2-2 contrats d'accueil (semaine type, annualisation,
 * facturation depuis les présences), P2-4 pré-inscriptions & liste d'attente,
 * P2-5 planning du personnel (migration 070). PostgreSQL réel, NOBYPASSRLS.
 *
 * P2-2 :
 *   1. contrat annualisé : daily_rate 1000 × 5 j × 48 sem / 12 = 20000 lissé ;
 *      ni montant ni tarif → 422 ; second contrat actif chevauchant → 409 ;
 *   2. facture du mois : 2 absences sur jours contractuels déduites (-2000,
 *      ligne adjustment), 1 présence hors contrat facturée (+1500) ; C04
 *      total = subtotal − discount respecté ; presence dans la réponse ;
 * P2-4 :
 *   3. capacité site = Σ max_capacity − inscrits − offres ; création demande
 *      PRE-<année>-<séq>, score fratrie/personnel, rang dans la file ;
 *   4. offre : salle hors site → 422 ; site plein → 409 SITE_FULL ;
 *      offre OK → offered + expiration ; acceptation → enfant créé
 *      `pre_registered`, child_id figé ; ré-acceptation → 409 ; décision
 *      sur demande sans offre → 409 ; expiration à la lecture → expired ;
 * P2-5 :
 *   5. créneau : chevauchement même membre → 409 SHIFT_OVERLAP (contrainte
 *      EXCLUDE) ; fin ≤ début → 422 ; absence déclarée → 409 ;
 *   6. generate-week depuis les affectations (dim→jeu = 5 créneaux, relance
 *      → 0 créé / 5 sautés) ; coverage : 12 enfants attendus, 1 éducatrice
 *      08–17 → breach (10/éduc) sur ces heures, 2e éducatrice → warning
 *      levé, gaps vides ;
 *   7. isolation : B ne voit ni demandes, ni créneaux, ni contrats de A ;
 *      réception peut gérer les pré-inscriptions mais pas le planning ;
 *      RLS forcée sur enrollment_requests et staff_shifts.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => { console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`); if (!v) failures.push(n); };

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  Object.assign(process.env, { DATABASE_URL: appUrl(), RATE_LIMIT_DISABLED: 'true', NODE_ENV: 'test', SENTRY_DSN: '' });
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };
  const tag = `p59-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 4);
  const cleanupOrgs = `(SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`;

  try {
    const role = async (slug) => (await db.query(`SELECT id FROM roles WHERE slug=$1`, [slug])).rows[0].id;
    const mkUser = async (email, orgId, slug) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u, await role(slug)]);
      return u;
    };
    const mkOrg = async (slug, name, cap) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,legal_name,wilaya) VALUES($1,$2,$2,'31') RETURNING id`, [slug, name])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'Site') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Papillons',$3) RETURNING id`, [org, site, cap])).rows[0].id;
      const director = await mkUser(`${slug}-director@test.dz`, org, 'director');
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`, 'Crèche A', 13);
    const B = await mkOrg(`${tag}-b`, 'Crèche B', 5);
    const site2 = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'Annexe') RETURNING id`, [A.org])).rows[0].id;
    const roomOther = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Annexe 1',5) RETURNING id`, [A.org, site2])).rows[0].id;
    const kids = [];
    for (let i = 0; i < 12; i++) {
      kids.push((await db.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,$4,$5,'Test','2024-03-01',$6) RETURNING id`,
        [A.org, A.site, A.room, `P59-${i}`, `Enfant${i}`, A.director])).rows[0].id);
    }
    const receptionist = await mkUser(`${tag}-recep@test.dz`, A.org, 'receptionist');
    void receptionist;
    const eduUser = await mkUser(`${tag}-edu@test.dz`, A.org, 'educator');
    const staff = (await db.query(`INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type) VALUES($1,$2,'educator_qualified','2025-01-01','permanent') RETURNING id`, [A.org, eduUser])).rows[0].id;
    const edu2User = await mkUser(`${tag}-edu2@test.dz`, A.org, 'educator');
    const staff2 = (await db.query(`INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type) VALUES($1,$2,'educator_qualified','2025-01-01','permanent') RETURNING id`, [A.org, edu2User])).rows[0].id;
    await db.query(`INSERT INTO staff_assignments(organization_id,staff_id,room_id,site_id,is_primary,start_date) VALUES($1,$2,$3,$4,true,'2025-01-01')`, [A.org, staff, A.room, A.site]);

    const login = async (email) => (await api('POST', '/auth/login', null, { email, password })).body.access_token;
    const tokenA = await login(`${tag}-a-director@test.dz`);
    const tokenB = await login(`${tag}-b-director@test.dz`);
    const tokenR = await login(`${tag}-recep@test.dz`);
    ok('JWT émis', Boolean(tokenA && tokenB && tokenR));

    // ── P2-2 ───────────────────────────────────────────────────────────────
    console.log('\n1) Contrat annualisé');
    // Mois de référence : juillet 2026 (1er juillet = mercredi). Semaine DZ dim→jeu.
    const c1 = await api('POST', '/billing/contracts', tokenA, { child_id: kids[0], start_date: '2026-01-01', daily_rate: 1000, annual_weeks: 48, absence_deduction: true, extra_day_rate: 1500 });
    ok('daily_rate 1000 × 5 j × 48 sem / 12 → monthly_base_amount 20000, semaine {7,1,2,3,4}', c1.status === 201 && Number(c1.body.monthly_base_amount) === 20000 && JSON.stringify(c1.body.weekly_schedule) === '[7,1,2,3,4]', JSON.stringify(c1.body).slice(0, 200));
    const noAmount = await api('POST', '/billing/contracts', tokenA, { child_id: kids[1], start_date: '2026-01-01' });
    ok('Ni montant ni tarif → 422 CONTRACT_AMOUNT_REQUIRED', noAmount.status === 422 && noAmount.body.code === 'CONTRACT_AMOUNT_REQUIRED');
    const overlap = await api('POST', '/billing/contracts', tokenA, { child_id: kids[0], start_date: '2026-06-01', monthly_base_amount: 5000 });
    ok('Second contrat actif chevauchant → 409 CONTRACT_OVERLAP', overlap.status === 409 && overlap.body.code === 'CONTRACT_OVERLAP');
    const custom = await api('POST', '/billing/contracts', tokenA, { child_id: kids[1], start_date: '2026-01-01', monthly_base_amount: 12000, weekly_schedule: [1, 3], hours_per_day: 4 });
    ok('Semaine type personnalisée (lundi/mercredi, 4 h/j) acceptée', custom.status === 201 && JSON.stringify(custom.body.weekly_schedule) === '[1,3]' && Number(custom.body.hours_per_day) === 4);
    ok('weekly_schedule invalide (jour 8) → 400', (await api('POST', '/billing/contracts', tokenA, { child_id: kids[2], start_date: '2026-01-01', monthly_base_amount: 1, weekly_schedule: [8] })).status === 400);

    console.log('\n2) Facture depuis les présences (juillet 2026)');
    // 2 absences sur jours contractuels (mer 1er, dim 5), 1 présence hors contrat (samedi 4).
    const sess = async (d, status) => db.query(`INSERT INTO attendance_sessions(organization_id,site_id,room_id,child_id,session_date,status) VALUES($1,$2,$3,$4,$5,$6)`, [A.org, A.site, A.room, kids[0], d, status]);
    await sess('2026-07-01', 'absent'); await sess('2026-07-05', 'absent'); await sess('2026-07-04', 'present'); await sess('2026-07-06', 'departed');
    const inv = await api('POST', '/billing/invoices/generate', tokenA, { contract_id: c1.body.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' });
    ok('Facture : subtotal 20000 − 2000 (2 abs.) + 1500 (1 j. hors contrat) = 19500, presence renseignée', inv.status === 201 && Number(inv.body.subtotal) === 19500 && Number(inv.body.total_amount) === 19500 && inv.body.presence.absent_contracted === 2 && inv.body.presence.extra_days === 1 && inv.body.presence.present_contracted === 1, JSON.stringify(inv.body).slice(0, 300));
    const lines = await db.query(`SELECT line_type, total_price FROM invoice_lines WHERE invoice_id=$1 ORDER BY total_price`, [inv.body.id]);
    ok('Lignes : care 20000, adjustment −2000, adjustment +1500 (traçables)', lines.rows.length === 3 && lines.rows.some((l) => l.line_type === 'adjustment' && Number(l.total_price) === -2000) && lines.rows.some((l) => l.line_type === 'adjustment' && Number(l.total_price) === 1500), JSON.stringify(lines.rows));
    const invB = await api('POST', '/billing/invoices/generate', tokenA, { contract_id: custom.body.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' });
    ok('Contrat sans déduction/supplément : facture inchangée (12000)', invB.status === 201 && Number(invB.body.total_amount) === 12000 && invB.body.presence.contracted_days === 9);

    // ── P2-4 ───────────────────────────────────────────────────────────────
    console.log('\n3) Pré-inscriptions : capacité, file, score');
    let cap = await api('GET', `/enrollment/capacity/${A.site}`, tokenA);
    ok('Capacité site A : 13 places − 12 inscrits = 1 disponible', cap.status === 200 && cap.body.capacity === 13 && cap.body.enrolled === 12 && cap.body.available === 1, JSON.stringify(cap.body));
    const mkReq = (extra) => api('POST', '/enrollment/requests', tokenR, { site_id: A.site, child_first_name: 'Nour', child_last_name: 'Test', child_date_of_birth: '2025-01-15', guardian_name: 'Amina T.', guardian_phone: '+213550000000', desired_start_date: '2026-10-01', ...extra });
    const r1 = await mkReq({});
    const r2 = await mkReq({ has_sibling: true });
    const r3 = await mkReq({ is_staff_child: true, priority_notes: 'Enfant de Mme X (éducatrice)' });
    ok('Réception : 3 demandes créées PRE-<année>-<séq>, scores 0 / 50 / 30', r1.status === 201 && /^PRE-\d{4}-\d+$/.test(r1.body.reference_number) && r1.body.priority_score === 0 && r2.body.priority_score === 50 && r3.body.priority_score === 30, JSON.stringify([r1.body, r2.body, r3.body]).slice(0, 200));
    ok('Téléphone invalide → 400', (await mkReq({ guardian_phone: 'abc' })).status === 400);
    const list = await api('GET', `/enrollment/requests?site_id=${A.site}`, tokenA);
    ok('File ordonnée par score : fratrie (rang 1), personnel (rang 2), simple (rang 3)', list.body.map((x) => x.id).join() === [r2.body.id, r3.body.id, r1.body.id].join() && list.body[0].rank === 1 && list.body[2].rank === 3, JSON.stringify(list.body.map((x) => [x.reference_number, x.priority_score, x.rank])));
    const wl = await api('POST', `/enrollment/requests/${r1.body.id}/waitlist`, tokenA);
    ok('Mise en liste d’attente → waitlisted ; re-waitlist → 409', wl.body.status === 'waitlisted' && (await api('POST', `/enrollment/requests/${r1.body.id}/waitlist`, tokenA)).status === 409);

    console.log('\n4) Offre, acceptation, expiration');
    ok('Offre sur salle d’un autre site → 422 ROOM_NOT_IN_SITE', (await api('POST', `/enrollment/requests/${r2.body.id}/offer`, tokenA, { room_id: roomOther })).body.code === 'ROOM_NOT_IN_SITE');
    ok('Décision sans offre → 409 ENROLLMENT_NO_OFFER', (await api('POST', `/enrollment/requests/${r2.body.id}/decide`, tokenA, { decision: 'accepted' })).body.code === 'ENROLLMENT_NO_OFFER');
    const offer = await api('POST', `/enrollment/requests/${r2.body.id}/offer`, tokenA, { room_id: A.room, offer_days: 3 });
    ok('Offre OK → offered, expiration ~3 jours', offer.status === 201 && offer.body.status === 'offered' && new Date(offer.body.offer_expires_at) > new Date(Date.now() + 2 * 86400000));
    cap = await api('GET', `/enrollment/capacity/${A.site}`, tokenA);
    ok('Capacité : l’offre en cours réserve la place (available 0)', cap.body.offered === 1 && cap.body.available === 0);
    ok('Site plein → 409 SITE_FULL pour la demande suivante', (await api('POST', `/enrollment/requests/${r3.body.id}/offer`, tokenA, { room_id: A.room })).body.code === 'SITE_FULL');
    const acc = await api('POST', `/enrollment/requests/${r2.body.id}/decide`, tokenA, { decision: 'accepted' });
    const child = acc.body.child_id ? (await db.query(`SELECT status, room_id, first_name_fr, enrollment_date::text FROM children WHERE id=$1`, [acc.body.child_id])).rows[0] : null;
    ok('Acceptation → enfant créé pre_registered dans la salle offerte, entrée = date souhaitée', acc.status === 201 && acc.body.status === 'accepted' && child && child.status === 'pre_registered' && child.room_id === A.room && child.first_name_fr === 'Nour' && child.enrollment_date === '2026-10-01', JSON.stringify({ acc: acc.body, child }));
    ok('Ré-décision → 409 ENROLLMENT_ALREADY_DECIDED', (await api('POST', `/enrollment/requests/${r2.body.id}/decide`, tokenA, { decision: 'declined' })).body.code === 'ENROLLMENT_ALREADY_DECIDED');
    cap = await api('GET', `/enrollment/capacity/${A.site}`, tokenA);
    ok('Capacité : pré-inscrit compté, plus d’offre (13 = 13 inscrits, available 0)', cap.body.enrolled === 13 && cap.body.offered === 0 && cap.body.available === 0);
    // Expiration à la lecture : on force offer_expires_at dans le passé sur r3 (offre simulée avec place libérée).
    await db.query(`UPDATE rooms SET max_capacity=14 WHERE id=$1`, [A.room]);
    await api('POST', `/enrollment/requests/${r3.body.id}/offer`, tokenA, { room_id: A.room, offer_days: 1 });
    await db.query(`UPDATE enrollment_requests SET offer_expires_at=NOW() - interval '1 minute' WHERE id=$1`, [r3.body.id]);
    const afterExpiry = await api('GET', `/enrollment/requests?status=expired`, tokenA);
    ok('Offre échue → expired à la lecture (sans job)', afterExpiry.body.some((x) => x.id === r3.body.id));
    ok('Décision « accepted » sur offre expirée → 409', (await api('POST', `/enrollment/requests/${r3.body.id}/decide`, tokenA, { decision: 'accepted' })).status === 409);
    const reoffer = await api('POST', `/enrollment/requests/${r3.body.id}/offer`, tokenA, { room_id: A.room });
    ok('Ré-offre possible après expiration', reoffer.status === 201 && reoffer.body.status === 'offered');
    ok('Retrait par la famille → withdrawn', (await api('POST', `/enrollment/requests/${r3.body.id}/decide`, tokenA, { decision: 'withdrawn', notes: 'A trouvé une autre crèche' })).body.status === 'withdrawn');

    // ── P2-5 ───────────────────────────────────────────────────────────────
    console.log('\n5) Créneaux : chevauchement, horaires, absence');
    const day = '2026-07-05'; // dimanche (jour ouvré DZ)
    const s1 = await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff, room_id: A.room, shift_date: day, start_time: '08:00', end_time: '13:00' });
    ok('Créneau 08–13 créé (site déduit de la salle)', s1.status === 201 && s1.body.site_id === A.site, JSON.stringify(s1.body));
    const ov = await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff, room_id: A.room, shift_date: day, start_time: '12:00', end_time: '17:00' });
    ok('Chevauchement 12–17 même membre → 409 SHIFT_OVERLAP (EXCLUDE gist)', ov.status === 409 && ov.body.code === 'SHIFT_OVERLAP', JSON.stringify(ov.body));
    const adj = await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff, room_id: A.room, shift_date: day, start_time: '13:00', end_time: '17:00' });
    ok('Créneau contigu 13–17 accepté (bornes [) )', adj.status === 201);
    ok('Fin ≤ début → 422 SHIFT_INVALID_TIMES', (await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff2, room_id: A.room, shift_date: day, start_time: '10:00', end_time: '09:00' })).body.code === 'SHIFT_INVALID_TIMES');
    ok('Heure mal formée → 400', (await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff2, room_id: A.room, shift_date: day, start_time: '8h', end_time: '17:00' })).status === 400);
    await db.query(`INSERT INTO staff_attendance(organization_id,staff_id,attendance_date,absence_type) VALUES($1,$2,'2026-07-06','sick')`, [A.org, staff2]);
    ok('Absence déclarée (maladie) → 409 SHIFT_STAFF_ABSENT', (await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff2, room_id: A.room, shift_date: '2026-07-06', start_time: '08:00', end_time: '17:00' })).body.code === 'SHIFT_STAFF_ABSENT');
    ok('Réception : planning → 403', (await api('POST', '/staff/schedule/shifts', tokenR, { staff_id: staff, room_id: A.room, shift_date: day, start_time: '18:00', end_time: '19:00' })).status === 403);

    console.log('\n6) Génération de semaine et couverture');
    const gen = await api('POST', '/staff/schedule/generate-week', tokenA, { week_start: '2026-07-12' });
    ok('generate-week (dim 12 → sam 18) : 5 créneaux depuis l’affectation active', gen.status === 201 && gen.body.created === 5 && gen.body.skipped === 0, JSON.stringify(gen.body));
    const gen2 = await api('POST', '/staff/schedule/generate-week', tokenA, { week_start: '2026-07-12' });
    ok('Relance idempotente : 0 créé, 5 sautés (chevauchements)', gen2.body.created === 0 && gen2.body.skipped === 5);
    const week = await api('GET', `/staff/schedule?from=2026-07-12&to=2026-07-18`, tokenA);
    ok('Planning de la semaine : 5 créneaux, membre et salle joints', week.body.items.length === 5 && week.body.items[0].room_name === 'Papillons' && week.body.items.every((x) => x.shift_type === 'work'));
    let cov = await api('GET', `/staff/schedule/coverage?date=2026-07-13`, tokenA);
    let room = cov.body.rooms.find((x) => x.room_id === A.room);
    ok('Couverture lundi 13 : 12 attendus (effectif actif), 1 éducatrice 08–17 → breach 08h–16h, required 2', room.expected_children === 12 && room.required_educators === 2 && room.gaps.length === 12 && room.slots.find((s) => s.hour === '08:00').status === 'breach', JSON.stringify(room).slice(0, 300));
    ok('La salle est dans alerts', cov.body.alerts.some((x) => x.room_id === A.room));
    const s2 = await api('POST', '/staff/schedule/shifts', tokenA, { staff_id: staff2, room_id: A.room, shift_date: '2026-07-13', start_time: '08:00', end_time: '17:00' });
    ok('2e éducatrice planifiée', s2.status === 201);
    cov = await api('GET', `/staff/schedule/coverage?date=2026-07-13`, tokenA);
    room = cov.body.rooms.find((x) => x.room_id === A.room);
    ok('Avec 2 éducatrices 08–17 : 08h–16h ok, seuls 07h et 17h–18h restent en défaut', room.slots.find((s) => s.hour === '10:00').status === 'ok' && room.gaps.join() === ['07:00', '17:00', '18:00'].join(), JSON.stringify(room.gaps));
    const del = await api('DELETE', `/staff/schedule/shifts/${s2.body.id}`, tokenA);
    ok('Suppression d’un créneau → 200 ; couverture redevient en défaut', del.status === 200 && (await api('GET', `/staff/schedule/coverage?date=2026-07-13`, tokenA)).body.alerts.some((x) => x.room_id === A.room));

    console.log('\n7) Isolation et RLS');
    ok('B : file vide, planning vide, contrats vides', (await api('GET', '/enrollment/requests', tokenB)).body.length === 0 && (await api('GET', `/staff/schedule?from=2026-07-01&to=2026-07-31`, tokenB)).body.items.length === 0 && (await api('GET', '/billing/contracts', tokenB)).body.length === 0);
    ok('B : capacité du site de A → 404', (await api('GET', `/enrollment/capacity/${A.site}`, tokenB)).status === 404);
    ok('B : offre sur demande de A → 404', (await api('POST', `/enrollment/requests/${r1.body.id}/offer`, tokenB, { room_id: B.room })).status === 404);
    ok('B : suppression d’un créneau de A → 404', (await api('DELETE', `/staff/schedule/shifts/${s1.body.id}`, tokenB)).status === 404);
    ok('B : créneau pour un membre de A → 404', (await api('POST', '/staff/schedule/shifts', tokenB, { staff_id: staff, room_id: B.room, shift_date: day, start_time: '08:00', end_time: '09:00' })).status === 404);
    const rls = await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('enrollment_requests','staff_shifts')`);
    ok('RLS activée ET forcée sur enrollment_requests et staff_shifts', rls.rows.length === 2 && rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
  } finally {
    try {
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN ${cleanupOrgs} AND status='pending'`);
      for (const t of ['audit_logs', 'data_access_logs', 'sessions', 'devices']) await db.query(`DELETE FROM ${t} WHERE organization_id IN ${cleanupOrgs}`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%')`);
    } catch (e) { console.error('Nettoyage phase59 partiel :', e.message); }
    await app.close();
    await db.end();
  }
  if (failures.length) { console.error(`\nÉCHEC Phase 59 : ${failures.length} — ${failures.join(' | ')}`); process.exit(1); }
  console.log('\n✓ Phase 59 validée : contrats d’accueil (P2-2), pré-inscriptions (P2-4), planning du personnel (P2-5) sur PostgreSQL réel NOBYPASSRLS.');
};
main().catch((e) => { console.error(e.stack); process.exit(1); });
