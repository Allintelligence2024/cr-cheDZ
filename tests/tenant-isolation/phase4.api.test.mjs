#!/usr/bin/env node
/**
 * Test API — Phase 4 (enfants, familles, import).
 *
 * Prérequis : apps/api compilé (dist/) et DATABASE_URL valide.
 * Vérifie :
 *  1. Isolation enfants : B ne voit/modifie/supprime pas les enfants de A (404)
 *  2. CRUD enfant : reference_number par org, patch (version++), soft delete
 *  3. Changement de salle tracé (room_moves) + historique statut
 *  4. Responsables : CRUD + lien avec permissions granulaires + unlink
 *  5. Contacts d'urgence + personnes autorisées à récupérer
 *  6. Import : dry-run sans écriture, rapport d'erreurs FR/AR, commit réel
 *  7. Rôles : educator lit mais ne crée pas ; accès fiche journalisé
 *
 * Usage : node tests/tenant-isolation/phase4.api.test.mjs
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
    // ── Setup : orgs A/B + director + educator (via SQL) ───────────────────
    const password = 'Password123!';
    const hash = await bcrypt.hash(password, 12);
    const directorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'director'`);
    const educatorRole = await admin.query(`SELECT id FROM roles WHERE slug = 'educator'`);

    async function makeOrg(slug, name) {
      const org = await admin.query(
        `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ($1, $2, '31') RETURNING id`,
        [slug, name],
      );
      const site = await admin.query(
        `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site') RETURNING id`,
        [org.rows[0].id],
      );
      const room = await admin.query(
        `INSERT INTO rooms (organization_id, site_id, name_fr, min_age_months, max_age_months, max_capacity)
         VALUES ($1, $2, 'Bébés', 3, 36, 12) RETURNING id`,
        [org.rows[0].id, site.rows[0].id],
      );
      const room2 = await admin.query(
        `INSERT INTO rooms (organization_id, site_id, name_fr, min_age_months, max_age_months, max_capacity)
         VALUES ($1, $2, 'Moyens', 36, 71, 15) RETURNING id`,
        [org.rows[0].id, site.rows[0].id],
      );
      const user = await admin.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'Directrice', 'D', $2, 'active') RETURNING id`,
        [`p4.dir.${slug}@test.dz`, hash],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [org.rows[0].id, user.rows[0].id, directorRole.rows[0].id],
      );
      const edu = await admin.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'Éducatrice', 'E', $2, 'active') RETURNING id`,
        [`p4.edu.${slug}@test.dz`, hash],
      );
      await admin.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())`,
        [org.rows[0].id, edu.rows[0].id, educatorRole.rows[0].id],
      );
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, room2: room2.rows[0].id, edu: edu.rows[0].id };
    }

    const A = await makeOrg('p4-a', 'Crèche P4 A');
    const B = await makeOrg('p4-b', 'Crèche P4 B');

    const loginA = await api('POST', '/auth/login', null, { email: 'p4.dir.p4-a@test.dz', password });
    const tokenA = loginA.body.access_token;
    const loginEduA = await api('POST', '/auth/login', null, { email: 'p4.edu.p4-a@test.dz', password });
    const eduTokenA = loginEduA.body.access_token;
    const loginB = await api('POST', '/auth/login', null, { email: 'p4.dir.p4-b@test.dz', password });
    const tokenB = loginB.body.access_token;

    // ── 2. CRUD enfant (org A) ─────────────────────────────────────────────
    console.log('\n1) CRUD enfant');
    const childA = await api('POST', '/children', tokenA, {
      site_id: A.site,
      room_id: A.room,
      first_name_fr: 'Yanis',
      last_name_fr: 'Amrani',
      date_of_birth: '2024-03-01',
      gender: 'M',
      schedule_type: 'full_time',
    });
    check('Création enfant A → 201 + reference_number', childA.status === 201
      && childA.body.reference_number && childA.body.reference_number.startsWith('P4A-')
      && childA.body.version === 1,
      `status=${childA.status} ${JSON.stringify(childA.body)}`);
    const refA = childA.body.reference_number;

    const childA2 = await api('POST', '/children', tokenA, {
      site_id: A.site,
      room_id: A.room,
      first_name_fr: 'Lina',
      last_name_fr: 'Amrani',
      date_of_birth: '2023-06-15',
      gender: 'F',
    });
    check('Second enfant → référence séquentielle différente',
      childA2.status === 201 && childA2.body.reference_number !== refA);

    const detailA = await api('GET', `/children/${childA.body.id}`, tokenA);
    check('Détail enfant A → 200', detailA.status === 200 && detailA.body.first_name_fr === 'Yanis');

    const patchA = await api('PATCH', `/children/${childA.body.id}`, tokenA, {
      room_id: A.room2,
      first_name_fr: 'Yanis',
      notes: 'Allergique aux arachides',
    });
    check('Patch enfant → version incrémentée', patchA.status === 200 && patchA.body.version === 2);

    const moveA = await api('POST', `/children/${childA.body.id}/move-room`, tokenA, {
      room_id: A.room,
      reason: 'Retour dans les bébés',
    });
    check('Move-room → room_id changé + tracé', moveA.status === 201 && moveA.body.moved === true);

    const roomMoves = await admin.query(
      `SELECT COUNT(*)::int AS n FROM room_moves WHERE child_id = $1`,
      [childA.body.id],
    );
    check('room_moves : 2 entrées (patch + move)', roomMoves.rows[0].n >= 2, `n=${roomMoves.rows[0].n}`);

    const listA = await api('GET', '/children?room_id=' + A.room, tokenA);
    check('Liste enfants par salle → 2 (Yanis + Lina)', listA.status === 200 && listA.body.total === 2);
    const listSearch = await api('GET', '/children?search=Lina', tokenA);
    check('Recherche Lina → 1', listSearch.status === 200 && listSearch.body.total === 1);

    // ── 1. Isolation enfants ───────────────────────────────────────────────
    console.log('\n2) Isolation multi-tenant (enfants)');
    const listB = await api('GET', '/children', tokenB);
    check('B liste ses enfants → 0 (aucun de A)', listB.status === 200 && listB.body.total === 0);

    const readAsB = await api('GET', `/children/${childA.body.id}`, tokenB);
    check('B lit l\'enfant de A → 404', readAsB.status === 404);
    const patchAsB = await api('PATCH', `/children/${childA.body.id}`, tokenB, { notes: 'Hacké' });
    check('B modifie l\'enfant de A → 404', patchAsB.status === 404);
    const delAsB = await api('DELETE', `/children/${childA.body.id}`, tokenB);
    check('B supprime l\'enfant de A → 404', delAsB.status === 404);
    const guardiansAsB = await api('GET', `/children/${childA.body.id}/guardians`, tokenB);
    check('B lit les gardiens de A → 404', guardiansAsB.status === 404);
    const dataAccess = await admin.query(
      `SELECT COUNT(*)::int AS n FROM data_access_logs
       WHERE data_subject_id = $1 AND data_type = 'child_record'`,
      [childA.body.id],
    );
    check('Accès fiche A journalisé (carnet 25-11)', dataAccess.rows[0].n >= 1);

    // ── 4. Responsables et liens ───────────────────────────────────────────
    console.log('\n3) Responsables, contacts, récupérations');
    const guardianA = await api('POST', '/children/guardians', tokenA, {
      first_name_fr: 'Salima',
      last_name_fr: 'Amrani',
      relationship: 'mother',
      phone_primary: '0550123456',
      email: 'salima.amrani@test.dz',
    });
    check('Création responsable → 201', guardianA.status === 201 && guardianA.body.id);

    const linkA = await api('POST', `/children/${childA.body.id}/guardians`, tokenA, {
      guardian_id: guardianA.body.id,
      is_legal_guardian: true,
      is_primary: true,
      can_view_journal: true,
      can_view_health: true,
      can_pickup: true,
      can_authorize_pickup: true,
    });
    check('Lien enfant↔responsable → 201 + is_primary', linkA.status === 201 && linkA.body.is_primary === true);

    const childGuardians = await api('GET', `/children/${childA.body.id}/guardians`, tokenA);
    check('Liste liens → 1 avec permissions', childGuardians.status === 200
      && childGuardians.body.items.length === 1
      && childGuardians.body.items[0].can_authorize_pickup === true);

    const guardianB = await api('POST', '/children/guardians', tokenA, {
      first_name_fr: 'Karim',
      last_name_fr: 'Amrani',
      relationship: 'father',
      phone_primary: '0660123456',
    });
    const linkSecondary = await api('POST', `/children/${childA.body.id}/guardians`, tokenA, {
      guardian_id: guardianB.body.id,
      is_legal_guardian: true,
      is_primary: false,
      can_view_journal: true,
      can_view_health: false,
      can_pickup: false,
    });
    check('Second parent → can_view_health=false', linkSecondary.status === 201
      && linkSecondary.body.can_view_health === false);

    const unlink = await api('DELETE', `/children/${childA.body.id}/guardians/${guardianB.body.id}`, tokenA);
    check('Unlink parent secondaire → 204', unlink.status === 204, `status=${unlink.status} ${JSON.stringify(unlink.body)}`);

    const emergency = await api('POST', `/children/${childA.body.id}/emergency-contacts`, tokenA, {
      first_name: 'Oncle',
      last_name: 'Amrani',
      relationship: 'oncle',
      phone_primary: '0770123456',
    });
    check('Contact d\'urgence → 201', emergency.status === 201);
    const emergencyList = await api('GET', `/children/${childA.body.id}/emergency-contacts`, tokenA);
    check('Liste contacts d\'urgence → 1', emergencyList.status === 200 && emergencyList.body.items.length === 1);

    const pickup = await api('POST', `/children/${childA.body.id}/pickups`, tokenA, {
      first_name: 'Grand-mère',
      last_name: 'Amrani',
      relationship: 'grandmother',
      phone: '0559988776',
      valid_until: '2027-01-01',
    });
    check('Personne autorisée → 201', pickup.status === 201 && pickup.body.is_active === true);
    const pickupDisabled = await api('PATCH', `/children/${childA.body.id}/pickups/${pickup.body.id}`, tokenA, {
      is_active: false,
    });
    check('Désactivation récupération → is_active=false', pickupDisabled.status === 200
      && pickupDisabled.body.is_active === false, `status=${pickupDisabled.status} ${JSON.stringify(pickupDisabled.body)}`);

    // ── 5. Soft delete ─────────────────────────────────────────────────────
    console.log('\n4) Soft delete');
    const delA = await api('DELETE', `/children/${childA2.body.id}`, tokenA);
    check('Soft delete enfant → 204', delA.status === 204);
    const gone = await api('GET', `/children/${childA2.body.id}`, tokenA);
    check('Enfant supprimé → 404', gone.status === 404);
    const statusHistory = await admin.query(
      `SELECT COUNT(*)::int AS n FROM child_status_history WHERE child_id = $1 AND status_to = 'departed'`,
      [childA2.body.id],
    );
    check('Historique statut → departed tracé', statusHistory.rows[0].n === 1);

    // ── 6. Import ──────────────────────────────────────────────────────────
    console.log('\n5) Import (dry-run puis commit)');
    const rows = [
      {
        first_name_fr: 'Adam',
        last_name_fr: 'Bouzid',
        date_of_birth: '2024-05-10',
        gender: 'M',
        guardian_first_name: 'Nadia',
        guardian_last_name: 'Bouzid',
        guardian_phone: '0551112233',
        guardian_relationship: 'mother',
      },
      {
        first_name_fr: 'Aya',
        last_name_fr: 'Bouzid',
        date_of_birth: '2023-11-20',
        gender: 'F',
        guardian_first_name: 'Nadia',
        guardian_last_name: 'Bouzid',
        guardian_phone: '0551112233',
        guardian_relationship: 'mother',
      },
      {
        first_name_fr: 'X', // invalide : prénom trop court
        last_name_fr: 'Erreur',
        date_of_birth: '2024-01-01',
      },
      {
        first_name_fr: 'Futur',
        last_name_fr: 'Erreur',
        date_of_birth: '2030-01-01', // invalide : futur
      },
    ];

    const dryRun = await api('POST', '/children/import', tokenA, { dry_run: true, rows });
    check('Import dry-run → 0 inséré, 2 erreurs', dryRun.status === 201
      && dryRun.body.inserted === 0 && dryRun.body.errors.length === 2,
      JSON.stringify(dryRun.body));
    check('Erreurs FR/AR présentes', dryRun.body.errors[0].message_fr.length > 0
      && dryRun.body.errors[0].message_ar.length > 0);
    const countAfterDry = await admin.query(
      `SELECT COUNT(*)::int AS n FROM children WHERE organization_id = $1 AND reference_number LIKE 'IMP-%'`,
      [A.org],
    );
    check('Dry-run : aucune écriture', countAfterDry.rows[0].n === 0);

    const commit = await api('POST', '/children/import', tokenA, { dry_run: false, rows });
    check('Import commit → 2 insérés, 2 erreurs', commit.status === 201
      && commit.body.inserted === 2 && commit.body.errors.length === 2,
      JSON.stringify(commit.body));

    const importedList = await api('GET', '/children?search=Bouzid', tokenA);
    check('Enfants importés visibles (2)', importedList.status === 200 && importedList.body.total === 2);
    const importedGuardians = await admin.query(
      `SELECT COUNT(*)::int AS n FROM child_guardians cg
       JOIN children c ON c.id = cg.child_id
       WHERE c.organization_id = $1 AND c.reference_number LIKE 'IMP-%'`,
      [A.org],
    );
    check('Gardiens liés aux enfants importés (2)', importedGuardians.rows[0].n === 2);

    // ── 7. Rôles ───────────────────────────────────────────────────────────
    console.log('\n6) Contrôle des rôles');
    const eduList = await api('GET', '/children', eduTokenA);
    check('Éducatrice liste les enfants → 200', eduList.status === 200);
    const eduCreate = await api('POST', '/children', eduTokenA, {
      site_id: A.site,
      first_name_fr: 'Interdit',
      last_name_fr: 'Test',
      date_of_birth: '2024-01-01',
    });
    check('Éducatrice crée un enfant → 403', eduCreate.status === 403);
    const eduImport = await api('POST', '/children/import', eduTokenA, { rows: [] });
    check('Éducatrice importe → 403', eduImport.status === 403);

    // ── Nettoyage (ordre dépendant des FK) ─────────────────────────────────
    const orgIds = `(SELECT id FROM organizations WHERE slug LIKE 'p4-%')`;
    await admin.query(`DELETE FROM data_access_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p4.%@test.dz')`);
    await admin.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p4.%@test.dz')`);
    await admin.query(`DELETE FROM child_guardians WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM emergency_contacts WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM authorized_pickups WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM room_moves WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM child_status_history WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM daily_summaries WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM children WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM guardians WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM org_sequences WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM memberships WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN ${orgIds}`);
    await admin.query(`DELETE FROM users WHERE email LIKE 'p4.%@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'p4-%'`);
  } finally {
    await app.close();
    await admin.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} test(s) en échec.`);
    process.exit(1);
  }
  console.log('✓ Phase 4 validée : enfants, familles, import, isolation.');
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.stack ?? error.message);
  process.exit(1);
});
