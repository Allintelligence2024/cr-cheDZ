#!/usr/bin/env node
/**
 * Prépare le compte e2e pour Playwright (CI uniquement) :
 * organisation + directeur e2e.director@test.dz / Password123!,
 * un site, une salle, un enfant, un contrat, et — depuis la phase
 * Antigravity (PR #48, Phase 4 / S1) — DEUX profils staff payables
 * (`base_salary` non-NULL, affectés à la salle). Sans staff payable,
 * `payroll-finalize-lock.spec.ts` reçoit un 422 PAYROLL_NO_STAFF
 * dès l'étape `POST /payroll/generate` et ne peut pas tester le
 * verrouillage post-finalisation (cf. R15 / migration 072).
 *
 * Idempotent : si le compte existe déjà, on continue pour rafraîchir le staff.
 * En local, rejouable sans tout casser.
 *
 * Usage : node tests/tenant-isolation/seed-e2e.mjs
 * Env    : DATABASE_URL (superuser ou role autorisé ; INSERT direct,
 *          sans RLS, pour créer le staff sans JWT).
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const directorEmail = 'e2e.director@test.dz';
  const exists = await client.query(`SELECT id FROM users WHERE email = $1`, [directorEmail]);
  if (exists.rows.length > 0) {
    console.log('Compte e2e déjà présent — on continue pour rafraîchir le staff');
  }
  const org = await client.query(
    `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('e2e-org', 'Crèche E2E', '31') ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
  );
  const hash = await bcrypt.hash('Password123!', 12);
  const director = await client.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, status)
     VALUES ($1, 'E2E', 'Director', $2, 'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [directorEmail, hash],
  );
  const directorId = director.rows[0].id;
  const role = await client.query(`SELECT id FROM roles WHERE slug = 'director'`);
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW())
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [org.rows[0].id, directorId, role.rows[0].id],
  );
  const site = await client.query(
    `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site E2E') RETURNING id`,
    [org.rows[0].id],
  );
  const siteId = site.rows[0].id;
  const room = await client.query(
    `INSERT INTO rooms (organization_id, site_id, name_fr, max_capacity) VALUES ($1, $2, 'Bébés E2E', 12) RETURNING id`,
    [org.rows[0].id, siteId],
  );
  const roomId = room.rows[0].id;
  const child = await client.query(
    `INSERT INTO children (organization_id, site_id, room_id, reference_number, first_name_fr, last_name_fr, date_of_birth, created_by)
     VALUES ($1, $2, $3, 'E2E-2026-00001', 'E2E', 'Child', '2024-01-01', $4) RETURNING id`,
    [org.rows[0].id, siteId, roomId, directorId],
  );
  const existingContract = await client.query(
    `SELECT id FROM contracts WHERE organization_id=$1 AND child_id=$2`,
    [org.rows[0].id, child.rows[0].id],
  );
  if (!existingContract.rows[0]) {
    await client.query(
      `INSERT INTO contracts (organization_id, child_id, monthly_base_amount, start_date, created_by)
       VALUES ($1, $2, 12000, '2026-01-01', $3)`,
      [org.rows[0].id, child.rows[0].id, directorId],
    );
  }

  const educators = [
    { email: 'e2e.educator1@test.dz', first: 'E2E', last: 'Educator1', base_salary: 35000 },
    { email: 'e2e.educator2@test.dz', first: 'E2E', last: 'Educator2', base_salary: 38000 },
  ];
  for (const e of educators) {
    const userRow = await client.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [e.email, e.first, e.last, hash],
    );
    const userId = userRow.rows[0].id;
    const educatorRole = await client.query(`SELECT id FROM roles WHERE slug = 'educator'`);
    if (educatorRole.rows[0]) {
      await client.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [org.rows[0].id, userId, educatorRole.rows[0].id],
      );
    }
    const existingProfile = await client.query(
      `SELECT id FROM staff_profiles WHERE organization_id = $1 AND user_id = $2`,
      [org.rows[0].id, userId],
    );
    if (existingProfile.rows[0]) {
      await client.query(
        `UPDATE staff_profiles SET base_salary = $1, is_active = true WHERE id = $2`,
        [e.base_salary, existingProfile.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO staff_profiles
           (organization_id, user_id, qualification, hire_date, contract_type, base_salary, is_active)
         VALUES ($1, $2, 'educator_qualified', '2024-09-01', 'permanent', $3, true)`,
        [org.rows[0].id, userId, e.base_salary],
      );
    }
    await client.query(
      `INSERT INTO staff_assignments (organization_id, staff_id, room_id, site_id, is_primary, start_date)
       SELECT $1, sp.id, $2, $3, true, '2024-09-01'
       FROM staff_profiles sp
       WHERE sp.organization_id = $1 AND sp.user_id = $4
         AND NOT EXISTS (
           SELECT 1 FROM staff_assignments sa
           WHERE sa.organization_id = $1 AND sa.staff_id = sp.id
         )`,
      [org.rows[0].id, roomId, siteId, userId],
    );
  }

  console.log(
    `Compte e2e créé : ${directorEmail} ` +
    `(site, salle, enfant, contrat + ${educators.length} profils staff payables)`,
  );
} finally {
  await client.end();
}
