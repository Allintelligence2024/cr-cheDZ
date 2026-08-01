#!/usr/bin/env node
/**
 * Test comportemental de l'isolation RLS (Phase 1 — le GATE).
 * Simule deux organisations et vérifie, sur une VRAIE base PostgreSQL :
 *  1. A insère un enfant, B ne le voit pas (SELECT → 0 ligne).
 *  2. B ne peut pas insérer un enfant appartenant à A (WITH CHECK).
 *  3. B ne peut pas modifier un enfant de A (USING).
 *  4. Sans tenant posé → 0 ligne (safe-by-default, jamais de fuite).
 *  5. B peut insérer/modifier SES propres données.
 *  6. Les événements de journal déclenchent les agrégats (daily_summaries).
 *
 * Usage : node tests/tenant-isolation/rls-behavior-check.mjs
 * Env   : DATABASE_URL (base migrée et seedée)
 */
import pg from 'pg';

const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Crée (ou met à jour) le rôle applicatif de test, clone de ce que
 * infrastructure/database/roles.sql fait en staging/prod (C06) :
 * un rôle NON superutilisateur avec NOBYPASSRLS — seul moyen de prouver
 * que la RLS protège réellement les données (le superuser contourne la RLS).
 */
import { appUrl, ensureAppRole } from './helpers.mjs';

async function main() {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  try {
    await ensureAppRole(admin);
    const APP_URL = appUrl();
    // ── Setup : deux organisations + sites + rooms ─────────────────────────
    const orgA = await admin.query(
      `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('test-org-a', 'Crèche A', '31') RETURNING id`,
    );
    const orgB = await admin.query(
      `INSERT INTO organizations (slug, name_fr, wilaya) VALUES ('test-org-b', 'Crèche B', '31') RETURNING id`,
    );
    const siteA = await admin.query(
      `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site A') RETURNING id`,
      [orgA.rows[0].id],
    );
    const siteB = await admin.query(
      `INSERT INTO sites (organization_id, name_fr) VALUES ($1, 'Site B') RETURNING id`,
      [orgB.rows[0].id],
    );
    const roomA = await admin.query(
      `INSERT INTO rooms (organization_id, site_id, name_fr) VALUES ($1, $2, 'Bébés A') RETURNING id`,
      [orgA.rows[0].id, siteA.rows[0].id],
    );
    const userA = await admin.query(
      `INSERT INTO users (email, first_name, last_name) VALUES ('edu.a@test.dz', 'Amel', 'A') RETURNING id`,
    );
    const userB = await admin.query(
      `INSERT INTO users (email, first_name, last_name) VALUES ('edu.b@test.dz', 'Brahim', 'B') RETURNING id`,
    );
    const orgAId = orgA.rows[0].id;
    const orgBId = orgB.rows[0].id;

    // ── A insère un enfant (contexte tenant A) ─────────────────────────────
    const ctxA = new pg.Client({ connectionString: APP_URL });
    await ctxA.connect();
    await ctxA.query('BEGIN');
    await ctxA.query("SELECT set_config('app.tenant_id', $1, true)", [orgAId]);
    await ctxA.query("SELECT set_config('app.user_id', $1, true)", [userA.rows[0].id]);
    const childA = await ctxA.query(
      `INSERT INTO children (organization_id, site_id, room_id, first_name_fr, last_name_fr, date_of_birth, created_by)
       VALUES ($1, $2, $3, 'Yanis', 'A', '2024-03-01', $4) RETURNING id`,
      [orgAId, siteA.rows[0].id, roomA.rows[0].id, userA.rows[0].id],
    );
    await ctxA.query('COMMIT');
    const childAId = childA.rows[0].id;
    console.log(`  (setup) Enfant A créé: ${childAId}`);

    // ── 1. B ne voit pas l'enfant de A ─────────────────────────────────────
    const ctxB = new pg.Client({ connectionString: APP_URL });
    await ctxB.connect();
    await ctxB.query('BEGIN');
    await ctxB.query("SELECT set_config('app.tenant_id', $1, true)", [orgBId]);
    await ctxB.query("SELECT set_config('app.user_id', $1, true)", [userB.rows[0].id]);
    const readAsB = await ctxB.query('SELECT id FROM children WHERE id = $1', [childAId]);
    check('B ne lit pas l\'enfant de A (0 ligne)', readAsB.rows.length === 0,
      `lignes: ${readAsB.rows.length}`);

    // ── 2. B ne peut pas insérer un enfant de A (WITH CHECK) ───────────────
    let insertBlocked = false;
    try {
      await ctxB.query(
        `INSERT INTO children (organization_id, site_id, room_id, first_name_fr, last_name_fr, date_of_birth, created_by)
         VALUES ($1, $2, $3, 'Intrus', 'X', '2024-01-01', $4)`,
        [orgAId, siteA.rows[0].id, roomA.rows[0].id, userB.rows[0].id],
      );
    } catch {
      insertBlocked = true;
    }
    check('B ne peut pas insérer un enfant de A (WITH CHECK)', insertBlocked);
    // L'erreur a avorté la transaction : on repart d'un état propre.
    await ctxB.query('ROLLBACK');
    await ctxB.query('BEGIN');
    await ctxB.query("SELECT set_config('app.tenant_id', $1, true)", [orgBId]);
    await ctxB.query("SELECT set_config('app.user_id', $1, true)", [userB.rows[0].id]);

    // ── 3. B ne peut pas modifier l'enfant de A (USING) ────────────────────
    const updateBlocked = await ctxB.query(
      `UPDATE children SET first_name_fr = 'Hacké' WHERE id = $1`,
      [childAId],
    );
    check('B ne peut pas modifier l\'enfant de A (0 ligne)', updateBlocked.rowCount === 0);

    // ── 4. Sans tenant posé → 0 ligne (safe-by-default) ────────────────────
    const noTenant = new pg.Client({ connectionString: APP_URL });
    await noTenant.connect();
    const readNoTenant = await noTenant.query('SELECT id FROM children');
    check('Sans tenant posé → 0 ligne (jamais de fuite)', readNoTenant.rows.length === 0);
    let noTenantInsertBlocked = false;
    try {
      await noTenant.query(
        `INSERT INTO children (organization_id, site_id, room_id, first_name_fr, last_name_fr, date_of_birth, created_by)
         VALUES ($1, $2, $3, 'Orphelin', 'X', '2024-01-01', $4)`,
        [orgAId, siteA.rows[0].id, roomA.rows[0].id, userA.rows[0].id],
      );
    } catch {
      noTenantInsertBlocked = true;
    }
    check('Sans tenant posé → INSERT refusé', noTenantInsertBlocked);
    await noTenant.end();

    // ── 5. B peut écrire SES propres données ───────────────────────────────
    const childB = await ctxB.query(
      `INSERT INTO children (organization_id, site_id, room_id, first_name_fr, last_name_fr, date_of_birth, created_by)
       VALUES ($1, $2, NULL, 'Lina', 'B', '2024-05-01', $3) RETURNING id`,
      [orgBId, siteB.rows[0].id, userB.rows[0].id],
    );
    const listAsB = await ctxB.query('SELECT id FROM children');
    check('B voit uniquement ses enfants', listAsB.rows.length === 1
      && listAsB.rows[0].id === childB.rows[0].id, `ids: ${listAsB.rows.map((r) => r.id).join(',')}`);

    // ── 6. Trigger daily_summaries (journal) ───────────────────────────────
    await ctxA.query('BEGIN');
    await ctxA.query("SELECT set_config('app.tenant_id', $1, true)", [orgAId]);
    await ctxA.query("SELECT set_config('app.user_id', $1, true)", [userA.rows[0].id]);
    await ctxA.query(
      `INSERT INTO daily_log_events (organization_id, child_id, room_id, event_date, event_type, occurred_at, recorded_by,
                                     meal_type, meal_quantity)
       VALUES ($1, $2, $3, CURRENT_DATE, 'meal', NOW(), $4, 'lunch', 'all')`,
      [orgAId, childAId, roomA.rows[0].id, userA.rows[0].id],
    );
    const summary = await ctxA.query(
      `SELECT meal_count, has_incident FROM daily_summaries WHERE child_id = $1 AND summary_date = CURRENT_DATE`,
      [childAId],
    );
    check('Trigger agrégats : daily_summaries.meal_count = 1',
      summary.rows.length === 1 && summary.rows[0].meal_count === 1,
      JSON.stringify(summary.rows));
    await ctxA.query('COMMIT');

    // ── 7. Immuabilité facture (C04) ───────────────────────────────────────
    const invoice = await ctxB.query(
      `INSERT INTO invoices (organization_id, invoice_number, child_id, period_year, period_month,
                             subtotal, discount_amount, total_amount, due_date, created_by)
       VALUES ($1, 'INV-TEST-1', $2, 2026, 8, 15000, 0, 15000, CURRENT_DATE, $3)
       RETURNING id`,
      [orgBId, childB.rows[0].id, userB.rows[0].id],
    );
    await ctxB.query(
      `UPDATE invoices SET status = 'paid', paid_amount = 15000 WHERE id = $1`,
      [invoice.rows[0].id],
    );
    let invoiceBlocked = false;
    try {
      await ctxB.query(`UPDATE invoices SET total_amount = 1 WHERE id = $1`, [invoice.rows[0].id]);
    } catch (error) {
      invoiceBlocked = error.message.includes('INVOICE_IMMUTABLE');
    }
    check('Facture payée non modifiable (INVOICE_IMMUTABLE)', invoiceBlocked);
    // L'erreur a avorté la transaction : ROLLBACK avant de clore proprement.
    await ctxB.query('ROLLBACK');

    // ── Nettoyage (ordre dépendant des FK) ─────────────────────────────────
    await ctxA.end();
    await ctxB.end();
    await admin.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'test-org-%')`);
    await admin.query(`DELETE FROM users WHERE email IN ('edu.a@test.dz', 'edu.b@test.dz')`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE 'test-org-%'`);

    console.log('');
    if (failures.length > 0) {
      console.error(`✗ ${failures.length} test(s) comportemental(aux) en échec.`);
      process.exit(1);
    }
    console.log('✓ Isolation RLS vérifiée comportementalement : aucun accès cross-tenant.');
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.message);
  process.exit(1);
});
