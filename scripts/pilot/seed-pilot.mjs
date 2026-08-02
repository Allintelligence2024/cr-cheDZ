#!/usr/bin/env node
/**
 * Seed des données de démarrage des 5 crèches pilotes (Phase 12).
 *
 * Crée par crèche : organisation, site, 3 salles, directrice + 2 éducatrices,
 * 15 enfants répartis, parents (gardiens avec permissions), contrats actifs,
 * profils staff + affectations. Comptes de test documentés dans
 * docs/pilot/ONBOARDING.md. Idempotent (slugs pilot-01…pilot-05).
 *
 * Usage : DATABASE_URL=… node scripts/pilot/seed-pilot.mjs [01 02 …]
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const PASSWORD = 'Password123!';
const PILOTS = [
  { num: '01', name: 'Crèche Pilote El-Djazair', wilaya: '16', type: 'creche' },
  { num: '02', name: 'Crèche Pilote Oran', wilaya: '31', type: 'creche' },
  { num: '03', name: 'Crèche Pilote Constantine', wilaya: '25', type: 'creche' },
  { num: '04', name: 'Multi-accueil Pilote Annaba', wilaya: '23', type: 'multi_accueil' },
  { num: '05', name: 'Jardin Pilote Sétif', wilaya: '19', type: 'jardin' },
];

const FIRST_NAMES = ['Yanis', 'Amine', 'Lina', 'Sara', 'Nadia', 'Rayan', 'Aya', 'Adam', 'Maria', 'Idir', 'Nour', 'Walid', 'Ines', 'Hamza', 'Dania', 'Yacine', 'Mira', 'Sami', 'Lyna', 'Anis'];
const LAST_NAMES = ['Benali', 'Bouzid', 'Haddad', 'Merbah', 'Kaci', 'Cherif', 'Boudiaf', 'Saidi', 'Mansouri', 'Taleb', 'Ziani', 'Guerfi', 'Brahimi', 'Ait-Ahmed', 'Belkacem'];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const roles = Object.fromEntries(
    (await client.query(`SELECT slug, id FROM roles WHERE slug IN ('director','educator','accountant','parent_primary')`)).rows.map((r) => [r.slug, r.id]),
  );
  const wanted = process.argv.slice(2);
  const pilots = wanted.length ? PILOTS.filter((p) => wanted.includes(p.num)) : PILOTS;

  for (const pilot of pilots) {
    const slug = `pilot-${pilot.num}`;
    const exists = await client.query(`SELECT id FROM organizations WHERE slug=$1`, [slug]);
    if (exists.rows.length > 0) {
      console.log(`→ ${slug} déjà présent, ignoré`);
      continue;
    }
    const org = (await client.query(
      `INSERT INTO organizations (slug, name_fr, wilaya, establishment_type, max_children, settings)
       VALUES ($1,$2,$3,$4,150,$5) RETURNING id`,
      [slug, pilot.name, pilot.wilaya, pilot.type, JSON.stringify({ pilot: true, pilot_number: Number(pilot.num) })],
    )).rows[0];
    const site = (await client.query(
      `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site principal') RETURNING id`, [org.id],
    )).rows[0];
    const rooms = [];
    for (const [name, minAge, maxAge, cap] of [['Bébés', 3, 12, 8], ['Moyens', 12, 24, 10], ['Grands', 24, 36, 12]]) {
      rooms.push((await client.query(
        `INSERT INTO rooms (organization_id, site_id, name_fr, name_ar, min_age_months, max_age_months, max_capacity, created_by)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,NULL) RETURNING id, name_fr`, [org.id, site.id, name, minAge, maxAge, cap],
      )).rows[0]);
    }
    const mkUser = async (email, first, last, roleSlug) => {
      const u = (await client.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [email, first, last, hash],
      )).rows[0];
      await client.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at) VALUES ($1,$2,$3,true,NOW())`,
        [org.id, u.id, roles[roleSlug]],
      );
      return u;
    };
    const director = await mkUser(`pilot-${pilot.num}.directrice@pilote.dz`, 'Directrice', pilot.name.replace(/^Crèche Pilote /, '').replace(/^Multi-accueil Pilote /, '').replace(/^Jardin Pilote /, ''), 'director');
    const educators = [
      await mkUser(`pilot-${pilot.num}.educatrice1@pilote.dz`, 'Éducatrice', 'Un', 'educator'),
      await mkUser(`pilot-${pilot.num}.educatrice2@pilote.dz`, 'Éducatrice', 'Deux', 'educator'),
    ];
    await mkUser(`pilot-${pilot.num}.comptable@pilote.dz`, 'Comptable', 'Pilote', 'accountant');

    // Staff profiles + affectations
    const staffByUser = new Map();
    for (const edu of educators) {
      const sp = (await client.query(
        `INSERT INTO staff_profiles (organization_id, user_id, qualification, hire_date, contract_type)
         VALUES ($1,$2,'educator_qualified',CURRENT_DATE,'permanent') RETURNING id`, [org.id, edu.id],
      )).rows[0];
      staffByUser.set(edu.id, sp.id);
    }
    await client.query(
      `INSERT INTO staff_assignments (organization_id, staff_id, room_id, site_id, is_primary, start_date, is_active)
       VALUES ($1,$2,$3,$4,true,CURRENT_DATE,true), ($1,$5,$6,$4,true,CURRENT_DATE,true)`,
      [org.id, staffByUser.get(educators[0].id), rooms[0].id, site.id, staffByUser.get(educators[1].id), rooms[2].id],
    );

    // 15 enfants + parents
    const children = [];
    for (let i = 0; i < 15; i += 1) {
      const room = rooms[i % rooms.length];
      const dob = new Date(Date.UTC(2023, (i * 7) % 12, (i % 27) + 1));
      const child = (await client.query(
        `INSERT INTO children (organization_id, site_id, room_id, reference_number, first_name_fr, first_name_ar, last_name_fr, last_name_ar, date_of_birth, gender, status, enrollment_date, created_by)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,NULL,$7,$8,'active',$9,$10) RETURNING id`,
        [org.id, site.id, room.id, `P${pilot.num}-${String(i + 1).padStart(3, '0')}`, FIRST_NAMES[i % FIRST_NAMES.length], LAST_NAMES[i % LAST_NAMES.length], dob, i % 2 === 0 ? 'M' : 'F', dob, director.id],
      )).rows[0];
      children.push(child.id);
      const guardian = (await client.query(
        `INSERT INTO guardians (organization_id, user_id, first_name_fr, last_name_fr, relationship, created_by)
         VALUES ($1,$2,'Parent','Pilote','parent',$3) RETURNING id`,
        [org.id, director.id, director.id],
      )).rows[0];
      await client.query(
        `INSERT INTO child_guardians (organization_id, child_id, guardian_id, can_view_journal, can_view_health, can_receive_invoices, can_receive_push)
         VALUES ($1,$2,$3,true,true,true,true)`,
        [org.id, child.id, guardian.id],
      );
    }

    // Contrats actifs (6 enfants)
    for (const childId of children.slice(0, 6)) {
      await client.query(
        `INSERT INTO contracts (organization_id, child_id, monthly_base_amount, start_date, is_active, created_by, includes_meals, meal_amount)
         VALUES ($1,$2,12000,'2026-01-01',true,$3,true,2500)`,
        [org.id, childId, director.id],
      );
    }

    console.log(`✓ ${slug} — ${pilot.name} (${children.length} enfants, 3 salles, directrice + 2 éducatrices + comptable)`);
  }
  await client.end();
  console.log(`\nComptes de test : pilot-NN.directrice@pilote.dz / ${PASSWORD} (voir docs/pilot/ONBOARDING.md)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
