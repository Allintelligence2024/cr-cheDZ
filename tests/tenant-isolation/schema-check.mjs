#!/usr/bin/env node
/**
 * Contrôle structurel du schéma (C01, C04, C05) — exécuté en CI.
 * Toute violation => code de sortie non nul.
 *
 * Vérifie :
 *  1. Toute table avec organization_id a la RLS activée ET forcée.
 *  2. Toute politique tenant a une clause WITH CHECK (INSERT protégé).
 *  3. Les contraintes financières (C04) sont présentes.
 *  4. sync_changelog existe (C02).
 *  5. Les migrations appliquées correspondent aux fichiers (drift).
 *
 * Usage : node tests/tenant-isolation/schema-check.mjs [--verbose]
 * Env   : DATABASE_URL
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'infrastructure', 'database', 'migrations');

const verbose = process.argv.includes('--verbose');
const failures = [];

// Tables système avec organization_id mais SANS RLS — volontaire (C01) :
// leur accès est contrôlé par les guards applicatifs et les rôles
// (super_admin, DPO, service d'authentification). Toute autre table avec
// organization_id DOIT avoir la RLS.
const SYSTEM_TABLES_WITHOUT_RLS = new Set([
  'users',             // compte global ; l'appartenance à une org passe par memberships (RLS)
  'roles',             // rôles système (org NULL) + rôles custom ; lus par les guards
  'sessions',          // authentification ; contrôlé par le service d'auth
  'audit_logs',        // journal d'audit : accès DPO/super_admin uniquement
  'data_access_logs',  // carnet d'accès : accès DPO/super_admin uniquement
]);

function check(name, ok, detail = '') {
  if (ok) {
    if (verbose) console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log('1) RLS sur toutes les tables tenant (C01)');

    // 1a. Tables avec organization_id mais sans RLS
    const noRls = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'organization_id'
        )
        AND NOT c.relrowsecurity
    `);
    const unexpectedNoRls = noRls.rows.filter((r) => !SYSTEM_TABLES_WITHOUT_RLS.has(r.table_name));
    check('Aucune table tenant sans RLS (hors tables système listées)', unexpectedNoRls.length === 0,
      unexpectedNoRls.map((r) => r.table_name).join(', '));

    // 1b. RLS FORCE partout
    const notForced = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relrowsecurity
        AND NOT c.relforcerowsecurity
    `);
    check('Toutes les tables RLS sont FORCE ROW LEVEL SECURITY', notForced.rows.length === 0,
      notForced.rows.map((r) => r.table_name).join(', '));

    // 1c. (audit) RLS sans AUCUNE policy = deny-all silencieux : une table
    // tenant doit avoir une politique explicite (une table « protégée » par
    // oubli de policy serait muette en production).
    const noPolicy = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
        )
    `);
    check('Toute table RLS a au moins une politique (pas de deny-all muet)', noPolicy.rows.length === 0,
      noPolicy.rows.map((r) => r.table_name).join(', '));

    // 1d. (audit) Les policies des tables tenant sont ancrées sur le tenant
    // (app_tenant_id() ou organization_id) — une policy qui n'y réfère pas
    // serait une porte ouverte.
    const unanchored = await client.query(`
      SELECT c.relname AS table_name, p.polname AS policy_name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'organization_id'
        )
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') !~ 'app_tenant_id|organization_id'
        AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ 'app_tenant_id|organization_id'
    `);
    check('Toute policy d’une table tenant référence le tenant (app_tenant_id/organization_id)', unanchored.rows.length === 0,
      unanchored.rows.map((r) => `${r.table_name}.${r.policy_name}`).join(', '));

    // 2. WITH CHECK sur les politiques d'écriture
    const noWithCheck = await client.query(`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
        AND cmd IN ('ALL', 'INSERT')
        AND (with_check IS NULL OR with_check = '')
    `);
    check('Toute politique a WITH CHECK (INSERT protégé)', noWithCheck.rows.length === 0,
      noWithCheck.rows.map((r) => `${r.tablename}.${r.policyname}`).join(', '));

    // 3. Contraintes financières (C04)
    const inv = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'invoices'::regclass AND conname = 'chk_invoice_amounts'
    `);
    check('Contrainte chk_invoice_amounts sur invoices', inv.rows.length === 1);

    const trg = await client.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'invoices'::regclass AND tgname = 'trg_invoice_immutable'
    `);
    check('Trigger trg_invoice_immutable (facture payée non modifiable)', trg.rows.length === 1);

    const payTrg = await client.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'payments'::regclass AND tgname = 'trg_payment_immutable'
    `);
    check('Trigger trg_payment_immutable (paiement confirmé non modifiable)', payTrg.rows.length === 1);

    // 4. sync_changelog (C02)
    const changelog = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sync_changelog'
        AND column_name = 'sync_seq'
    `);
    check('sync_changelog.sync_seq existe (curseur monotone C02)', changelog.rows.length === 1);

    // 5. Drift migrations (C05)
    console.log('5) Drift des migrations (C05)');
    const applied = new Map(
      (await client.query('SELECT filename, checksum FROM schema_migrations')).rows
        .map((r) => [r.filename, r.checksum]),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const checksum = createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
        .digest('hex');
      check(`Migration ${file} appliquée`, applied.has(file));
      if (applied.has(file)) {
        check(`Checksum ${file} identique`, applied.get(file) === checksum);
      }
    }

    console.log('');
    if (failures.length > 0) {
      console.error(`✗ ${failures.length} contrôle(s) en échec.`);
      process.exit(1);
    }
    console.log('✓ Schéma conforme : RLS complète, contraintes financières, curseur monotone, migrations cohérentes.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('✗ Erreur d\'exécution:', error.message);
  process.exit(1);
});
