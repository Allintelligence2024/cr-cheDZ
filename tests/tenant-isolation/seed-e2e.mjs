#!/usr/bin/env node
/**
 * Prépare le compte e2e pour Playwright (CI uniquement) :
 * organisation + directeur e2e.director@test.dz / Password123!.
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
    return;
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
  console.log('Compte e2e créé :', email);
} finally {
  await client.end();
}
