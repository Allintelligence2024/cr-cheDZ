#!/usr/bin/env node
/**
 * Prépare le compte e2e pour Playwright (CI uniquement) :
 * organisation + directeur e2e.director@test.dz / Password123!,
 * un site, une salle, un enfant et un contrat (parcours directeur Phase 9).
 * Usage : node tests/tenant-isolation/seed-e2e.mjs
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const email = 'e2e.director@test.dz';
  const exists = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (exists.rows.length > 0) {
    console.log('Compte e2e déjà présent');
    process.exit(0);
  }
  const org = await client.query(
    `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('e2e-org', 'Crèche E2E', '31') ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
  );
  const hash = await bcrypt.hash('Password123!', 12);
  const user = await client.query(
    `INSERT INTO users (email, first_name, last_name, password_hash, status)
     VALUES ($1, 'E2E', 'Director', $2, 'active') RETURNING id`,
    [email, hash],
  );
  const role = await client.query(`SELECT id FROM roles WHERE slug = 'director'`);
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW())`,
    [org.rows[0].id, user.rows[0].id, role.rows[0].id],
  );
  const site = await client.query(
    `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site E2E') RETURNING id`,
    [org.rows[0].id],
  );
  const room = await client.query(
    `INSERT INTO rooms (organization_id, site_id, name_fr, max_capacity) VALUES ($1, $2, 'Bébés E2E', 12) RETURNING id`,
    [org.rows[0].id, site.rows[0].id],
  );
  const child = await client.query(
    `INSERT INTO children (organization_id, site_id, room_id, reference_number, first_name_fr, last_name_fr, date_of_birth, created_by)
     VALUES ($1, $2, $3, 'E2E-2026-00001', 'E2E', 'Child', '2024-01-01', $4) RETURNING id`,
    [org.rows[0].id, site.rows[0].id, room.rows[0].id, user.rows[0].id],
  );
  await client.query(
    `INSERT INTO contracts (organization_id, child_id, monthly_base_amount, start_date, created_by)
     VALUES ($1, $2, 12000, '2026-01-01', $3)`,
    [org.rows[0].id, child.rows[0].id, user.rows[0].id],
  );
  console.log('Compte e2e créé :', email, '(site, salle, enfant, contrat)');
} finally {
  await client.end();
}
