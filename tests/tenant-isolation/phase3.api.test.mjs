#!/usr/bin/env node
/**
 * Test API — Phase 3 (organisations, sites, salles, invitations, staff).
 *
 * Prérequis : apps/api compilé (dist/) et DATABASE_URL valide.
 * Vérifie :
 *  1. Super_admin crée des organisations ; un non-super_admin → 403
 *  2. Cycle d'invitation complet : invite → token → accept → login actif
 *  3. Director crée site + salle ; lecture rooms OK (éducatrice même org)
 *  4. Isolation : org B ne voit ni ne modifie les salles de A (404)
 *  5. Une éducatrice ne peut pas créer de salle (403)
 *  6. Staff : création profil, documents (alerte expiration), affectation,
 *     pointage — visibles uniquement dans l'org propriétaire
 *  7. Feature flags : globaux + surcharges org
 *  8. Invitation en double → 409 ALREADY_MEMBER
 *
 * Usage : node tests/tenant-isolation/phase3.api.test.mjs
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, path, token, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  try {
    // ── Setup : super_admin + directrices (via SQL) ────────────────────────
    const password = 'Password123!';
    const hash = await bcrypt.hash(password, 12);
    const superAdmin = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status, is_super_admin)
       VALUES ('p3.super@test.dz', 'Super', 'Admin', $1, 'active', true) RETURNING id`,
      [hash],
    );
    const directorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'director'`);

    const login = await api('POST', '/auth/login', null, { email: 'p3.super@test.dz', password });
    check('Login super_admin → 200', login.status === 200, `status=${login.status}`);
    const superToken = login.body.access_token;

    // ── 1. Création d'organisations (super_admin uniquement) ───────────────
    console.log('\n1) Organisations (super_admin)');
    const orgA = await api('POST', '/organizations', superToken, {
      slug: 'p3-creche-a',
      name_fr: 'Crèche A Phase 3',
      wilaya: '31',
      establishment_type: 'creche',
    });
    check('Création org A → 201', orgA.status === 201 && orgA.body.id, `status=${orgA.status}`);
    const orgB = await api('POST', '/organizations', superToken, {
      slug: 'p3-creche-b',
      name_fr: 'Crèche B Phase 3',
      wilaya: '16',
    });
    check('Création org B → 201', orgB.status === 201);
    const slugDup = await api('POST', '/organizations', superToken, {
      slug: 'p3-creche-a',
      name_fr: 'Doublon',
      wilaya: '31',
    });
    check('Slug en double → 409 SLUG_TAKEN', slugDup.status === 409 && slugDup.body.code === 'SLUG_TAKEN');

    const orgList = await api('GET', '/organizations', superToken);
    check('Liste organisations → 2', orgList.status === 200 && orgList.body.items.length === 2);

    // ── 2. Cycle d'invitation complet ──────────────────────────────────────
    console.log('\n2) Invitations et acceptation');
    const invEduA = await api('POST', '/invitations', superToken, {
      email: 'p3.edu.a@test.dz',
      role_slug: 'educator',
      first_name: 'Amel',
      last_name: 'Amrani',
      organization_id: orgA.body.id,
    });
    check('Invitation éducatrice A → 201 + token', invEduA.status === 201
      && invEduA.body.invitation_token && invEduA.body.role_slug === 'educator',
      `status=${invEduA.status} ${JSON.stringify(invEduA.body)}`);

    const invEduB = await api('POST', '/invitations', superToken, {
      email: 'p3.edu.b@test.dz',
      role_slug: 'educator',
      organization_id: orgB.body.id,
    });
    check('Invitation éducatrice B → 201', invEduB.status === 201);

    const badAccept = await api('POST', '/auth/accept-invitation', null, {
      invitation_token: 'faux-token-0123456789abcdef',
      first_name: 'Xavier',
      last_name: 'Yamani',
      password: 'Password123!',
    });
    check('Token invalide → 400 INVALID_INVITATION', badAccept.status === 400
      && badAccept.body.code === 'INVALID_INVITATION');

    const acceptA = await api('POST', '/auth/accept-invitation', null, {
      invitation_token: invEduA.body.invitation_token,
      first_name: 'Amel',
      last_name: 'Amrani',
      password,
    });
    check('Acceptation invitation A → 200 + tokens', acceptA.status === 200
      && acceptA.body.access_token, `status=${acceptA.status} ${JSON.stringify(acceptA.body).slice(0, 120)}`);
    check('Acceptation A → rôle educator + org A', acceptA.body.user?.role === 'educator'
      && acceptA.body.user?.organization_id === orgA.body.id);

    const meEduA = await api('GET', '/me', acceptA.body.access_token);
    check('/me éducatrice A → org A + joined', meEduA.status === 200
      && meEduA.body.memberships?.[0]?.organization_id === orgA.body.id
      && meEduA.body.memberships?.[0]?.role_slug === 'educator'
      && meEduA.body.memberships?.[0]?.joined_at != null);

    const reuseToken = await api('POST', '/auth/accept-invitation', null, {
      invitation_token: invEduA.body.invitation_token,
      first_name: 'Amel',
      last_name: 'Amrani',
      password,
    });
    check('Invitation déjà utilisée → 400 INVITATION_ALREADY_USED',
      reuseToken.status === 400 && reuseToken.body.code === 'INVITATION_ALREADY_USED');

    // Invitation en double (même org) → 409
    const dupInvite = await api('POST', '/invitations', superToken, {
      email: 'p3.edu.a@test.dz',
      role_slug: 'educator',
      organization_id: orgA.body.id,
    });
    check('Invitation en double → 409 ALREADY_MEMBER', dupInvite.status === 409
      && dupInvite.body.code === 'ALREADY_MEMBER');

    const acceptB = await api('POST', '/auth/accept-invitation', null, {
      invitation_token: invEduB.body.invitation_token,
      first_name: 'Brahim',
      last_name: 'Benali',
      password,
    });
    check('Acceptation invitation B → 200', acceptB.status === 200);

    // ── 3. Director : sites + salles ───────────────────────────────────────
    console.log('\n3) Sites et salles (director)');
    const dirA = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('p3.dir.a@test.dz', 'Dalila', 'DirA', $1, 'active') RETURNING id`,
      [hash],
    );
    await admin.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [orgA.body.id, dirA.rows[0].id, directorRole.rows[0].id],
    );
    const dirB = await admin.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ('p3.dir.b@test.dz', 'Djamila', 'DirB', $1, 'active') RETURNING id`,
      [hash],
    );
    await admin.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [orgB.body.id, dirB.rows[0].id, directorRole.rows[0].id],
    );

    const loginDirA = await api('POST', '/auth/login', null, { email: 'p3.dir.a@test.dz', password });
    const dirAToken = loginDirA.body.access_token;
    const loginDirB = await api('POST', '/auth/login', null, { email: 'p3.dir.b@test.dz', password });
    const dirBToken = loginDirB.body.access_token;

    const siteA = await api('POST', '/sites', dirAToken, { name_fr: 'Site Principal A', wilaya: '31' });
    check('Création site A → 201', siteA.status === 201 && siteA.body.id, `status=${siteA.status}`);
    const roomA = await api('POST', '/rooms', dirAToken, {
      name_fr: 'Bébés A',
      site_id: siteA.body.id,
      min_age_months: 3,
      max_age_months: 36,
      max_capacity: 12,
    });
    check('Création salle A → 201', roomA.status === 201 && roomA.body.id, `status=${roomA.status} ${JSON.stringify(roomA.body)}`);

    const roomsDirA = await api('GET', '/rooms', dirAToken);
    check('Director A voit sa salle', roomsDirA.status === 200 && roomsDirA.body.items.length === 1);
    const roomsEduA = await api('GET', '/rooms', acceptA.body.access_token);
    check('Éducatrice A (même org) voit la salle', roomsEduA.status === 200
      && roomsEduA.body.items.length === 1);

    // ── 4. Isolation : org B ne touche pas aux données de A ────────────────
    console.log('\n4) Isolation multi-tenant (Phase 3)');
    const roomsDirB = await api('GET', '/rooms', dirBToken);
    check('Director B ne voit aucune salle de A', roomsDirB.status === 200 && roomsDirB.body.items.length === 0);
    const readRoomB = await api('GET', `/rooms/${roomA.body.id}`, dirBToken);
    check('B lit la salle de A → 404', readRoomB.status === 404);
    const patchRoomB = await api('PATCH', `/rooms/${roomA.body.id}`, dirBToken, { name_fr: 'Hacké' });
    check('B modifie la salle de A → 404', patchRoomB.status === 404);
    const delRoomB = await api('DELETE', `/rooms/${roomA.body.id}`, dirBToken);
    check('B supprime la salle de A → 404', delRoomB.status === 404);
    const patchSiteB = await api('PATCH', `/sites/${siteA.body.id}`, dirBToken, { name_fr: 'Hacké' });
    check('B modifie le site de A → 404', patchSiteB.status === 404);

    // ── 5. Rôles : une éducatrice ne crée pas de salle ─────────────────────
    console.log('\n5) Contrôle des rôles');
    const eduCreatesRoom = await api('POST', '/rooms', acceptA.body.access_token, {
      name_fr: 'Interdit',
      site_id: siteA.body.id,
    });
    check('Éducatrice POST /rooms → 403', eduCreatesRoom.status === 403);
    const eduCreatesOrg = await api('POST', '/organizations', acceptA.body.access_token, {
      slug: 'p3-interdit',
      name_fr: 'Interdit',
      wilaya: '31',
    });
    check('Éducatrice POST /organizations → 403', eduCreatesOrg.status === 403);
    const eduInvites = await api('POST', '/invitations', acceptA.body.access_token, {
      email: 'p3.x@test.dz',
      role_slug: 'educator',
    });
    check('Éducatrice POST /invitations → 403', eduInvites.status === 403);

    // ── 6. Staff ───────────────────────────────────────────────────────────
    console.log('\n6) Personnel (profils, documents, affectations, pointage)');
    const meEduA2 = await api('GET', '/me', acceptA.body.access_token);
    const eduAUserId = meEduA2.body.id;
    const staffA = await api('POST', '/staff', dirAToken, {
      user_id: eduAUserId,
      qualification: 'educator_qualified',
      hire_date: '2025-09-01',
      contract_type: 'permanent',
    });
    check('Création profil staff A → 201', staffA.status === 201 && staffA.body.id,
      `status=${staffA.status} ${JSON.stringify(staffA.body)}`);

    const staffNoMember = await api('POST', '/staff', dirAToken, {
      user_id: dirB.rows[0].id, // user de l'org B
      qualification: 'educator_qualified',
      hire_date: '2025-09-01',
    });
    check('Profil staff pour un non-membre → 400 USER_NOT_MEMBER',
      staffNoMember.status === 400 && staffNoMember.body.code === 'USER_NOT_MEMBER');

    const staffListA = await api('GET', '/staff', dirAToken);
    check('Director A liste son staff → 1', staffListA.status === 200 && staffListA.body.items.length === 1);
    const staffListB = await api('GET', '/staff', dirBToken);
    check('Director B ne voit aucun staff de A', staffListB.status === 200 && staffListB.body.items.length === 0);

    const docA = await api('POST', `/staff/${staffA.body.id}/documents`, dirAToken, {
      document_type: 'diploma',
      title: 'Diplôme éducatrice',
      storage_key: 'staff/diplome-a.pdf',
      expiry_date: '2026-09-01',
      alert_days_before: 30,
    });
    check('Création document staff → 201', docA.status === 201, `status=${docA.status}`);
    const expiring = await api('GET', '/staff/documents/expiring?days=365', dirAToken);
    check('Alerte expiration document → présent', expiring.status === 200
      && expiring.body.items.length === 1 && expiring.body.items[0].document_type === 'diploma');

    const assignA = await api('POST', `/staff/${staffA.body.id}/assignments`, dirAToken, {
      room_id: roomA.body.id,
      is_primary: true,
      start_date: '2026-08-01',
    });
    check('Affectation salle → 201', assignA.status === 201 && assignA.body.is_primary === true,
      `status=${assignA.status} ${JSON.stringify(assignA.body)}`);

    const attA = await api('POST', `/staff/${staffA.body.id}/attendance`, dirAToken, {
      attendance_date: '2026-08-01',
      check_in: '2026-08-01T07:45:00.000Z',
      absence_type: 'present',
    });
    check('Pointage staff → 201', attA.status === 201 && attA.body.check_in, `status=${attA.status}`);
    const attList = await api('GET', `/staff/${staffA.body.id}/attendance`, dirAToken);
    check('Liste pointages → 1', attList.status === 200 && attList.body.items.length === 1);

    // ── 7. Feature flags ───────────────────────────────────────────────────
    console.log('\n7) Feature flags');
    const flags = await api('GET', '/feature-flags', dirAToken);
    const onlinePayment = flags.body.items?.find((f) => f.flag_key === 'online_payment');
    check('Feature flags → online_payment présent et off', flags.status === 200
      && onlinePayment && onlinePayment.is_enabled === false);

    // ── 8. Liste des membres (invitations) ─────────────────────────────────
    console.log('\n8) Membres');
    const members = await api('GET', '/invitations', dirAToken);
    check('Liste membres org A → éducatrice A active', members.status === 200
      && members.body.items.some((m) => m.email === 'p3.edu.a@test.dz' && m.joined_at != null),
      JSON.stringify(members.body)?.slice(0, 200));

    // ── Nettoyage (ordre dépendant des FK) ─────────────────────────────────
    const orgIds = `(SELECT id FROM organizations WHERE slug LIKE 'p3-%')`;
    await admin.query(`DELETE FROM devices WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p3.%@test.dz')`);
    await admin.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p3.%@test.dz')`);
    await admin.query(`DELETE FROM staff_attendance WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM staff_assignments WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM staff_documents WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM staff_profiles WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM memberships WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM users WHERE email LIKE 'p3.%@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'p3-%'`);
  } finally {
    await app.close();
    await admin.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} test(s) en échec.`);
    process.exit(1);
  }
  console.log('✓ Phase 3 validée : organisations, invitations, sites/salles, staff, isolation.');
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.stack ?? error.message);
  process.exit(1);
});
