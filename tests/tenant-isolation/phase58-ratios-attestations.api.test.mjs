#!/usr/bin/env node
/**
 * Phase 58 GATE — P2-1 ratios d'encadrement temps réel + P2-6 attestations
 * de frais de garde (migration 069), PostgreSQL réel, rôle NOBYPASSRLS.
 *
 * P2-1 :
 *   1. salle vide → status empty ; 1 éducatrice affectée, 3 présents → ok,
 *      headroom = 7 (10/éducateur) ; les paramètres viennent de RATIO_EDUC ;
 *   2. warning MIN_EDUCATORS (1 éducatrice < 2) apparaît en alerte, jamais
 *      bloquant ; 11e présent → breach RATIO_EXCEEDED : le check-in est ACCEPTÉ
 *      (l'enfant est là), la réponse porte ratio.status='breach', une ligne
 *      compliance_checks realtime est écrite UNE seule fois par salle et par jour ;
 *   3. pointage du personnel activé (staff_attendance check_in) → basis
 *      on_duty ; éducatrice non pointée → NO_EDUCATOR ; pointée → ok de nouveau ;
 *   4. dashboard expose ratios + alerts.ratio_breaches ; B ne voit rien de A.
 * P2-6 :
 *   5. émission sans facture ni présence → 422 ATTESTATION_EMPTY ;
 *   6. émission : montants = factures émises non annulées de l'année (brouillon
 *      exclu), jours = présences, numéro ATT-<année>-<séq>, tuteur facturable ;
 *   7. PDF téléchargeable (%PDF, contient le numéro) ; data_access_logs écrit ;
 *   8. immuable en base (UPDATE/DELETE → ATTESTATION_IMMUTABLE) ; réémission
 *      après nouveau paiement → nouveau numéro, l'ancienne garde ses chiffres ;
 *   9. parent facturable : liste + PDF ; parent non facturable → liste vide,
 *      PDF 403 ; B → 404 ; RLS forcée.
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
  const api = async (method, path, token, body, raw = false) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    if (raw) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), headers: r.headers };
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };
  const tag = `p58-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 4);
  const cleanupOrgs = `(SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`;
  const year = new Date().getFullYear();

  try {
    const role = async (slug) => (await db.query(`SELECT id FROM roles WHERE slug=$1`, [slug])).rows[0].id;
    const mkUser = async (email, orgId, slug) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u, await role(slug)]);
      return u;
    };
    const mkOrg = async (slug, name) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,legal_name,wilaya,registration_number,address_line1) VALUES($1,$2,$3,'31','AGR-31-0042','12 rue des Jasmins') RETURNING id`, [slug, name, `SARL ${name}`])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'Site principal') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Papillons',15) RETURNING id`, [org, site])).rows[0].id;
      const director = await mkUser(`${slug}-director@test.dz`, org, 'director');
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`, 'Crèche A');
    const B = await mkOrg(`${tag}-b`, 'Crèche B');
    const children = [];
    for (let i = 0; i < 12; i++) {
      children.push((await db.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,$4,$5,'Test','2024-03-01',$6) RETURNING id`,
        [A.org, A.site, A.room, `P58-${i}`, `Enfant${i}`, A.director])).rows[0].id);
    }
    const childB = (await db.query(`INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,'P58-B','Lina','Test','2024-03-01',$4) RETURNING id`, [B.org, B.site, B.room, B.director])).rows[0].id;
    // Éducatrice qualifiée affectée à la salle
    const eduUser = await mkUser(`${tag}-edu@test.dz`, A.org, 'educator');
    const staff = (await db.query(`INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type) VALUES($1,$2,'educator_qualified','2025-01-01','permanent') RETURNING id`, [A.org, eduUser])).rows[0].id;
    await db.query(`INSERT INTO staff_assignments(organization_id,staff_id,room_id,site_id,is_primary,start_date) VALUES($1,$2,$3,$4,true,'2025-01-01')`, [A.org, staff, A.room, A.site]);
    // Tuteurs de l'enfant 0 : facturable (parent principal) + non facturable
    const parentBill = await mkUser(`${tag}-parent-bill@test.dz`, A.org, 'parent_primary');
    const parentNo = await mkUser(`${tag}-parent-no@test.dz`, A.org, 'parent_secondary');
    const gBill = (await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'Karim','Benali','father',$3) RETURNING id`, [A.org, parentBill, A.director])).rows[0].id;
    const gNo = (await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'Tante','Benali','other',$3) RETURNING id`, [A.org, parentNo, A.director])).rows[0].id;
    await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_primary,can_receive_invoices) VALUES($1,$2,$3,true,true)`, [A.org, children[0], gBill]);
    await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_primary,can_receive_invoices) VALUES($1,$2,$3,false,false)`, [A.org, children[0], gNo]);

    const login = async (email) => (await api('POST', '/auth/login', null, { email, password })).body.access_token;
    const tokenA = await login(`${tag}-a-director@test.dz`);
    const tokenB = await login(`${tag}-b-director@test.dz`);
    const tokenBill = await login(`${tag}-parent-bill@test.dz`);
    const tokenNo = await login(`${tag}-parent-no@test.dz`);
    ok('JWT émis (directeurs A/B, parents)', Boolean(tokenA && tokenB && tokenBill && tokenNo));

    // ── P2-1 ───────────────────────────────────────────────────────────────
    console.log('\n1) Ratios : salle vide puis 3 présents');
    let r = await api('GET', '/attendance/ratios', tokenA);
    let room = r.body.rooms.find((x) => x.room_id === A.room);
    ok('Salle vide → status empty, paramètres RATIO_EDUC (10/éduc, min 2)', r.status === 200 && room && room.status === 'empty' && room.max_children_per_educator === 10 && room.min_educators === 2, JSON.stringify(room));
    for (let i = 0; i < 3; i++) await api('POST', '/attendance/check-in', tokenA, { child_id: children[i] });

    r = await api('GET', '/attendance/ratios', tokenA);
    room = r.body.rooms.find((x) => x.room_id === A.room);
    ok('3 présents / 1 éducatrice affectée → basis assigned, warning MIN_EDUCATORS, headroom 7', room.children_present === 3 && room.basis === 'assigned' && room.educators_counted === 1 && room.status === 'warning' && room.reasons.includes('MIN_EDUCATORS') && room.headroom === 7, JSON.stringify(room));
    ok('La salle figure dans alerts (warning)', r.body.alerts.some((x) => x.room_id === A.room));

    console.log('\n2) Franchissement au check-in : accepté, alerté, tracé une fois');
    for (let i = 3; i < 10; i++) await api('POST', '/attendance/check-in', tokenA, { child_id: children[i] });
    const tenth = await api('GET', '/attendance/ratios', tokenA);
    ok('10 présents / 1 éducatrice → encore autorisé (warning NEAR_LIMIT ou MIN_EDUCATORS), headroom 0', tenth.body.rooms.find((x) => x.room_id === A.room).status === 'warning' && tenth.body.rooms.find((x) => x.room_id === A.room).headroom === 0);
    const eleventh = await api('POST', '/attendance/check-in', tokenA, { child_id: children[10] });
    ok('11e check-in ACCEPTÉ (201/200) avec ratio.status=breach RATIO_EXCEEDED dans la réponse', eleventh.status < 300 && eleventh.body.ratio && eleventh.body.ratio.status === 'breach' && eleventh.body.ratio.reasons.includes('RATIO_EXCEEDED'), JSON.stringify(eleventh.body).slice(0, 300));
    const twelfth = await api('POST', '/attendance/check-in', tokenA, { child_id: children[11] });
    ok('12e check-in accepté aussi (jamais bloquant)', twelfth.status < 300 && twelfth.body.ratio.children_present === 12);
    const checks = await db.query(`SELECT count(*)::int AS n FROM compliance_checks WHERE organization_id=$1 AND checked_by='realtime' AND result='fail'`, [A.org]);
    ok('compliance_checks : UNE seule ligne realtime pour la salle aujourd’hui (pas de spam)', checks.rows[0].n === 1, `n=${checks.rows[0].n}`);
    const checkRow = (await db.query(`SELECT details FROM compliance_checks WHERE organization_id=$1 AND checked_by='realtime'`, [A.org])).rows[0].details;
    ok('Détails de la trace : room_id, children_present=11, reasons', checkRow.room_id === A.room && checkRow.children_present === 11 && Array.isArray(checkRow.reasons), JSON.stringify(checkRow));

    console.log('\n3) Pointage du personnel : basis on_duty');
    const today = (await db.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date::text AS d`)).rows[0].d;
    // Un autre membre pointé (admin) active le mode on_duty — l'éducatrice, elle, n'est pas pointée.
    const adminUser = await mkUser(`${tag}-admin@test.dz`, A.org, 'receptionist');
    const adminStaff = (await db.query(`INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type) VALUES($1,$2,'admin','2025-01-01','permanent') RETURNING id`, [A.org, adminUser])).rows[0].id;
    await db.query(`INSERT INTO staff_attendance(organization_id,staff_id,attendance_date,check_in) VALUES($1,$2,$3,NOW())`, [A.org, adminStaff, today]);
    r = await api('GET', '/attendance/ratios', tokenA);
    room = r.body.rooms.find((x) => x.room_id === A.room);
    ok('Personnel pointé mais éducatrice absente → basis on_duty, breach NO_EDUCATOR', room.basis === 'on_duty' && room.educators_on_duty === 0 && room.status === 'breach' && room.reasons.includes('NO_EDUCATOR'), JSON.stringify(room));
    await db.query(`INSERT INTO staff_attendance(organization_id,staff_id,attendance_date,check_in) VALUES($1,$2,$3,NOW())`, [A.org, staff, today]);
    r = await api('GET', '/attendance/ratios', tokenA);
    room = r.body.rooms.find((x) => x.room_id === A.room);
    ok('Éducatrice pointée → educators_on_duty=1, 12 présents → breach RATIO_EXCEEDED (cohérent)', room.educators_on_duty === 1 && room.status === 'breach' && room.reasons.includes('RATIO_EXCEEDED'), JSON.stringify(room));
    // Départ de 3 enfants → 9 présents : ok côté ratio, mais MIN_EDUCATORS reste un warning
    for (let i = 0; i < 3; i++) await api('POST', '/attendance/check-out', tokenA, { child_id: children[i] });
    r = await api('GET', '/attendance/ratios', tokenA);
    room = r.body.rooms.find((x) => x.room_id === A.room);
    ok('Après 3 départs : 9 présents → plus de breach (warning MIN_EDUCATORS/NEAR_LIMIT)', room.children_present === 9 && room.status === 'warning', JSON.stringify(room));

    console.log('\n4) Tableau de bord et isolation');
    const dash = await api('GET', '/dashboard/summary', tokenA);
    ok('Dashboard A : ratios[] et alerts.ratio_breaches présents', dash.status === 200 && Array.isArray(dash.body.ratios) && Array.isArray(dash.body.alerts.ratio_breaches) && dash.body.alerts.ratio_breaches.some((x) => x.room_id === A.room), JSON.stringify(dash.body.alerts.ratio_breaches).slice(0, 200));
    const rB = await api('GET', '/attendance/ratios', tokenB);
    ok('B : uniquement sa salle (vide), aucune donnée de A', rB.body.rooms.length === 1 && rB.body.rooms[0].room_id === B.room && rB.body.rooms[0].status === 'empty' && rB.body.alerts.length === 0);
    await api('POST', '/attendance/check-in', tokenB, { child_id: childB });
    const rB2 = await api('GET', '/attendance/ratios', tokenB);
    ok('B (aucune affectation) : basis unconfigured, warning STAFF_NOT_CONFIGURED, jamais breach', rB2.body.rooms[0].basis === 'unconfigured' && rB2.body.rooms[0].status === 'warning' && rB2.body.rooms[0].reasons.includes('STAFF_NOT_CONFIGURED') && rB2.body.rooms[0].headroom === 14, JSON.stringify(rB2.body.rooms[0]));
    ok('B : aucune trace compliance_checks realtime (module personnel non configuré)', (await db.query(`SELECT count(*)::int AS n FROM compliance_checks WHERE organization_id=$1 AND checked_by='realtime'`, [B.org])).rows[0].n === 0);
    await api('POST', '/attendance/check-out', tokenB, { child_id: childB });
    ok('Parent : /attendance/ratios → 403', (await api('GET', '/attendance/ratios', tokenBill)).status === 403);

    // ── P2-6 ───────────────────────────────────────────────────────────────
    console.log('\n5) Attestation vide');
    const empty = await api('POST', '/attestations', tokenA, { child_id: childB, year });
    ok('Enfant de B depuis A → 404', empty.status === 404);
    const emptyA = await api('POST', '/attestations', tokenA, { child_id: children[5], year: year - 3 });
    ok('Aucune facture ni présence sur l’année → 422 ATTESTATION_EMPTY', emptyA.status === 422 && emptyA.body.code === 'ATTESTATION_EMPTY', JSON.stringify(emptyA.body).slice(0, 120));

    console.log('\n6) Émission');
    const contract = (await api('POST', '/billing/contracts', tokenA, { child_id: children[0], monthly_base_amount: 15000, start_date: `${year}-01-01` })).body;
    const inv1 = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: year, period_month: 1, due_date: `${year}-02-05` })).body;
    const inv2 = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: year, period_month: 2, due_date: `${year}-03-05` })).body;
    const invDraft = (await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.id, period_year: year, period_month: 3, due_date: `${year}-04-05` })).body;
    await api('POST', `/billing/invoices/${inv1.id}/send`, tokenA);
    await api('POST', `/billing/invoices/${inv2.id}/send`, tokenA);
    await api('POST', '/billing/cash-register/open', tokenA, { site_id: A.site, opening_balance: 0 });
    await api('POST', '/billing/payments/cash', tokenA, { invoice_id: inv1.id, amount: 15000 });
    ok('Contexte : 2 factures émises (30000), 1 brouillon exclu, 15000 réglés', inv1.id && inv2.id && invDraft.id);
    const issued = await api('POST', '/attestations', tokenA, { child_id: children[0], year });
    ok(`Émission → 201, ATT-${year}-<séq>, invoiced 30000, paid 15000, 2 factures, 1 jour de présence, tuteur facturable`,
      issued.status === 201 && new RegExp(`^ATT-${year}-\\d+$`).test(issued.body.attestation_number) && Number(issued.body.total_invoiced) === 30000 && Number(issued.body.total_paid) === 15000
        && issued.body.invoice_count === 2 && issued.body.days_present === 1 && issued.body.guardian_id === gBill && issued.body.period_start === today,
      JSON.stringify(issued.body));
    const att1 = issued.body;

    console.log('\n7) PDF');
    const pdf = await api('GET', `/attestations/${att1.id}/pdf`, tokenA, undefined, true);
    ok('PDF → 200 application/pdf, commence par %PDF', pdf.status === 200 && pdf.headers.get('content-type').includes('application/pdf') && pdf.buffer.subarray(0, 4).toString() === '%PDF', `status=${pdf.status}`);
    ok('PDF : police arabe embarquée (> 5 Ko) et nom de fichier = numéro', pdf.buffer.length > 5000 && pdf.headers.get('content-disposition').includes(att1.attestation_number), `len=${pdf.buffer.length}`);
    const access = await db.query(`SELECT count(*)::int AS n FROM data_access_logs WHERE organization_id=$1 AND data_type='attestation_pdf'`, [A.org]);
    ok('data_access_logs : consultation attestation journalisée', access.rows[0].n === 1, `n=${access.rows[0].n}`);

    console.log('\n8) Immuabilité et réémission');
    let immutable = false;
    try { await db.query(`UPDATE attestations SET total_paid=0 WHERE id=$1`, [att1.id]); } catch (e) { immutable = /ATTESTATION_IMMUTABLE/.test(e.message); }
    ok('UPDATE (même superuser) → ATTESTATION_IMMUTABLE', immutable);
    immutable = false;
    try { await db.query(`DELETE FROM attestations WHERE id=$1`, [att1.id]); } catch (e) { immutable = /ATTESTATION_IMMUTABLE/.test(e.message); }
    ok('DELETE → ATTESTATION_IMMUTABLE', immutable);
    await api('POST', '/billing/payments/cash', tokenA, { invoice_id: inv2.id, amount: 15000 });
    const reissued = await api('POST', '/attestations', tokenA, { child_id: children[0], year });
    ok('Réémission après paiement → nouveau numéro, paid 30000', reissued.status === 201 && reissued.body.attestation_number !== att1.attestation_number && Number(reissued.body.total_paid) === 30000, JSON.stringify(reissued.body).slice(0, 160));
    const list = await api('GET', `/attestations?child_id=${children[0]}`, tokenA);
    ok('Liste : 2 attestations, l’ancienne conserve paid 15000', list.body.length === 2 && Number(list.body.find((a) => a.id === att1.id).total_paid) === 15000);

    console.log('\n9) Parent et isolation');
    const pl = await api('GET', '/parent/attestations', tokenBill);
    ok('Parent facturable : liste ses 2 attestations', pl.status === 200 && pl.body.length === 2, JSON.stringify(pl.body).slice(0, 120));
    const ppdf = await api('GET', `/parent/attestations/${att1.id}/pdf`, tokenBill, undefined, true);
    ok('Parent facturable : PDF 200', ppdf.status === 200 && ppdf.buffer.subarray(0, 4).toString() === '%PDF');
    ok('Parent non facturable : liste vide', (await api('GET', '/parent/attestations', tokenNo)).body.length === 0);
    ok('Parent non facturable : PDF → 403 PARENT_ACCESS_DENIED', (await api('GET', `/parent/attestations/${att1.id}/pdf`, tokenNo)).status === 403);
    ok('Parent : POST /attestations → 403', (await api('POST', '/attestations', tokenBill, { child_id: children[0], year })).status === 403);
    ok('B : PDF de l’attestation de A → 404', (await api('GET', `/attestations/${att1.id}/pdf`, tokenB)).status === 404);
    ok('B : liste vide', (await api('GET', '/attestations', tokenB)).body.length === 0);
    const rls = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='attestations'`);
    ok('attestations : RLS activée ET forcée', rls.rows[0].relrowsecurity && rls.rows[0].relforcerowsecurity);

    // ── 10) L2I : `site_id` est un identifiant DÉCLARÉ par le client ────────
    // Placé en fin de suite : la sonde crée des sessions, donc elle ne doit pas
    // décaler les compteurs de ratio des sections précédentes. Le service
    // retombait sur le site de l'enfant quand le champ était absent (défaut
    // sûr), mais recopiait SANS VÉRIFICATION celui fourni par le client — et
    // une clé étrangère PostgreSQL ne consulte pas le RLS : une session de
    // l'org A pouvait référencer un site de l'org B (mesuré : 201 + ligne liée).
    console.log('\n10) `site_id` déclaré : périmètre vérifié');
    const mkChild = async (ref) => (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,$4,'Sofia','Test','2024-04-01',$5) RETURNING id`,
      [A.org, A.site, A.room, ref, A.director],
    )).rows[0].id;
    const childAlien = await mkChild('P58-L2I-alien');
    const childOwn = await mkChild('P58-L2I-own');
    const alienSite = await api('POST', '/attendance/check-in', tokenA, { child_id: childAlien, site_id: B.site });
    ok('`site_id` d’une AUTRE organisation → refus (site hors périmètre)',
      alienSite.status >= 400 && alienSite.status < 500,
      `status=${alienSite.status} ${JSON.stringify(alienSite.body).slice(0, 120)}`);
    const alienRows = (await db.query('SELECT count(*)::int AS n FROM attendance_sessions WHERE child_id=$1', [childAlien])).rows[0].n;
    ok('Aucune session créée pour un `site_id` hors périmètre',
      alienRows === 0, `sessions créées pour l’enfant ciblé : ${alienRows}`);
    const ownSite = await api('POST', '/attendance/check-in', tokenA, { child_id: childOwn, site_id: A.site });
    const ownRow = ownSite.body?.id
      ? (await db.query('SELECT site_id FROM attendance_sessions WHERE child_id=$1', [childOwn])).rows[0]
      : null;
    ok('`site_id` de la MÊME organisation → accepté et rattaché (la garde n’est pas un mur)',
      (ownSite.status === 200 || ownSite.status === 201) && ownRow?.site_id === A.site,
      `status=${ownSite.status} site=${ownRow?.site_id}`);
  } finally {
    try {
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN ${cleanupOrgs} AND status='pending'`);
      for (const t of ['audit_logs', 'data_access_logs', 'sessions', 'devices']) await db.query(`DELETE FROM ${t} WHERE organization_id IN ${cleanupOrgs}`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%')`);
    } catch (e) { console.error('Nettoyage phase58 partiel :', e.message); }
    await app.close();
    await db.end();
  }
  if (failures.length) { console.error(`\nÉCHEC Phase 58 : ${failures.length} — ${failures.join(' | ')}`); process.exit(1); }
  console.log('\n✓ Phase 58 validée : ratios temps réel (P2-1) + attestations (P2-6) sur PostgreSQL réel NOBYPASSRLS.');
};
main().catch((e) => { console.error(e.stack); process.exit(1); });
