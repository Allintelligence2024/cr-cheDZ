#!/usr/bin/env node
/**
 * Prépare le compte e2e synthétique pour Playwright (CI ou base de test locale
 * jetable uniquement — jamais production/staging partagé) : organisation +
 * directeur e2e.director@test.dz / Password123!,
 * un site, une salle, un enfant, un contrat (parcours directeur Phase 9) et —
 * depuis le lot 2 de la remédiation 2026-09-27 — un employé rémunéré, sans
 * lequel la paie n'est pas générable.
 *
 * Usage : node tests/tenant-isolation/seed-e2e.mjs
 *
 * Rejouable : le script complète ce qui manque au lieu de s'arrêter. La
 * sortie anticipée « Compte e2e déjà présent » masquait un défaut — sur une
 * base déjà Director-seedée, l'employé n'était jamais créé et les specs de
 * paie échouaient en 422 PAYROLL_NO_STAFF.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const email = 'e2e.director@test.dz';
  const exists = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
  const fresh = exists.rows.length === 0;
  const org = await client.query(
    `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('e2e-org', 'Crèche E2E', '31') ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
  );
  const hash = await bcrypt.hash('Password123!', 12);
  const user = fresh
    ? await client.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status)
         VALUES ($1, 'E2E', 'Director', $2, 'active') RETURNING id`,
        [email, hash],
      )
    : exists;
  const role = await client.query(`SELECT id FROM roles WHERE slug = 'director'`);
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
    [org.rows[0].id, user.rows[0].id, role.rows[0].id],
  );

  // Site / salle / enfant / contrat : idempotents par garde d'existence, pour
  // que le seed complète une base partiellement seedée au lieu d'échouer.
  const site = await client.query(
    `INSERT INTO sites (organization_id, name_fr) SELECT $1, 'Site E2E'
      WHERE NOT EXISTS (SELECT 1 FROM sites WHERE organization_id = $1) RETURNING id`,
    [org.rows[0].id],
  );
  const siteId = site.rows[0]?.id
    ?? (await client.query(`SELECT id FROM sites WHERE organization_id = $1 LIMIT 1`, [org.rows[0].id])).rows[0].id;
  const room = await client.query(
    `INSERT INTO rooms (organization_id, site_id, name_fr, max_capacity) SELECT $1, $2, 'Bébés E2E', 12
      WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE organization_id = $1) RETURNING id`,
    [org.rows[0].id, siteId],
  );
  const roomId = room.rows[0]?.id
    ?? (await client.query(`SELECT id FROM rooms WHERE organization_id = $1 LIMIT 1`, [org.rows[0].id])).rows[0]?.id;
  const child = await client.query(
    `INSERT INTO children (organization_id, site_id, room_id, reference_number, first_name_fr, last_name_fr, date_of_birth, created_by)
     SELECT $1, $2, $3, 'E2E-2026-00001', 'E2E', 'Child', '2024-01-01', $4
      WHERE NOT EXISTS (SELECT 1 FROM children WHERE organization_id = $1) RETURNING id`,
    [org.rows[0].id, siteId, roomId, user.rows[0].id],
  );
  const childId = child.rows[0]?.id
    ?? (await client.query(`SELECT id FROM children WHERE organization_id = $1 LIMIT 1`, [org.rows[0].id])).rows[0].id;
  await client.query(
    `INSERT INTO contracts (organization_id, child_id, monthly_base_amount, start_date, created_by)
     SELECT $1, $2, 12000, '2026-01-01', $3
      WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE organization_id = $1 AND child_id = $2)`,
    [org.rows[0].id, childId, user.rows[0].id],
  );

  // LOT 2 (remédiation 2026-09-27) — un employé rémunéré, sans lequel la paie
  // n'est tout simplement pas générable : POST /payroll/generate répond 422
  // PAYROLL_NO_STAFF (« Aucun employé avec salaire de base ») quand la table
  // staff est vide. Les specs payroll-finalize-lock tournaient donc dans le
  // vide — elles n'avaient jamais pu être exécutées, même avec un navigateur.
  // Le profil staff exige en outre une AFFILIATION (sinon 400 USER_NOT_MEMBER :
  // « Cet utilisateur n'est pas membre de l'organisation »), d'où les deux
  // insertions ci-dessous et non une seule.
  const staffEmail = 'e2e.educator@test.dz';
  const educator = await client.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, status)
     VALUES ($1, 'E2E', 'Educator', $2, 'active')
     -- Migration 095 : users.email n'est plus une contrainte UNIQUE absolue
     -- mais un index PARTIEL (WHERE deleted_at IS NULL). ON CONFLICT (email)
     -- nu doit cibler cet index explicitement, sinon 42P10. L'upsert ne
     -- concerne que des comptes vivants (le seed ne pose pas deleted_at).
     ON CONFLICT (email) WHERE deleted_at IS NULL
     DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [staffEmail, await bcrypt.hash('Password123!', 12)],
  );
  const educatorRole = await client.query(`SELECT id FROM roles WHERE slug = 'educator'`);
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
    [org.rows[0].id, educator.rows[0].id, educatorRole.rows[0].id],
  );
  // Pas de `ON CONFLICT (organization_id, user_id)` : staff_profiles n'a
  // qu'une PK sur `id`, aucune contrainte d'unicité sur le couple — la clause
  // échouerait. Idempotence assurée par un garde `WHERE NOT EXISTS`, ce qui
  // rend le seed rejouable. La table n'a pas non plus de `created_by`.
  await client.query(
    `INSERT INTO staff_profiles (organization_id, user_id, employee_number, qualification, hire_date, contract_type, base_salary)
     SELECT $1, $2, 'E2E-01', 'educator_qualified', '2024-01-15', 'permanent', 45000
      WHERE NOT EXISTS (SELECT 1 FROM staff_profiles WHERE organization_id = $1 AND user_id = $2)`,
    [org.rows[0].id, educator.rows[0].id],
  );

  // DPO e2e (remédiation 2.1/2.2 + fix e2e 2026-10-08) : les endpoints
  // privacy sont protégés par @Permissions('privacy:manage'), que le seed
  // 003_attribue EXPLICITEMENT au dpo et non au director (séparation loi
  // 25-11). privacy-anonymization.spec.ts fait le parcours anonymisation
  // avec ce compte. On crée un utilisateur dédié plutôt qu'un
  // role_assignments sur le director existant : le JWT porte les rôles
  // effectifs (auth_user_roles lit role_assignments), mais le frontend
  // routeAccess.currentRole() lit memberships[] (rôle principal) — un
  // director+nouveau-rôle-dpo afficherait l'onglet Anonymisation via
  // canAnonymizeChild, mais un utilisateur dont le rôle PRINCIPAL est dpo
  // est le reflet exact de la séparation réglementaire voulue.
  const dpoEmail = 'e2e.dpo@test.dz';
  const dpoUser = await client.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, status)
     VALUES ($1, 'E2E', 'Dpo', $2, 'active')
     ON CONFLICT (email) WHERE deleted_at IS NULL
     DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [dpoEmail, await bcrypt.hash('Password123!', 12)],
  );
  const dpoRole = await client.query(`SELECT id FROM roles WHERE slug = 'dpo'`);
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
    [org.rows[0].id, dpoUser.rows[0].id, dpoRole.rows[0].id],
  );

  const staffCount = (await client.query(
    `SELECT count(*)::int AS n FROM staff_profiles WHERE organization_id = $1 AND base_salary > 0`, [org.rows[0].id],
  )).rows[0].n;
  console.log(
    fresh ? 'Compte e2e créé :' : 'Compte e2e complété :',
    email, `(site, salle, enfant, contrat, ${staffCount} employé(s) rémunéré(s), dpo ${dpoEmail})`,
  );
  if (staffCount === 0) {
    console.error('✗ aucun employé rémunéré : /payroll/generate répondra 422 PAYROLL_NO_STAFF');
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
