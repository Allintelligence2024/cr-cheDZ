#!/usr/bin/env node
/**
 * GARDE ANTI-BYPASS RLS (audit, étape 4.1 — MISSION P2 : catalogue réel).
 * Le bug P0 (UPDATE payments via pool brute : 0 ligne silencieuse sous
 * NOBYPASSRLS) serait mort né si ce contrôle avait existé.
 *
 * Principe : dans apps/api/src, TOUT accès `pool.query` / `this.pool.query`
 * BRUT (hors withTenantConnection, qui pose app.tenant_id) ne peut porter QUE
 * sur :
 *   1. une FONCTION SECURITY DEFINER — la liste n'est PLUS codée en dur :
 *      elle est DÉRIVÉE du CATALOGUE réel (pg_proc WHERE prosecdef, schéma
 *      public) au moment du check. Toute fonction appelée par un pool.query
 *      doit y être ; une fonction qui existe dans le catalogue sans être
 *      SECURITY DEFINER est une DIVERGENCE explicite (échec) ;
 *   2. des TABLES SYSTÈME sans RLS, explicitement listées et CROISÉES avec
 *      le catalogue (pg_class : la table doit exister AVEC relrowsecurity =
 *      false — une table figée qui a désormais la RLS active est une
 *      DIVERGENCE explicite, échec).
 *
 * Modes :
 *   - DATABASE_URL défini  → vérification contre le catalogue réel (CI job
 *     database, runner d'isolation) ;
 *   - DATABASE_URL absent  → MODE FALLBACK : listes figées + AVERTISSEMENT
 *     explicite (aucune vérification catalogue possible sans base).
 *
 * Les listes figées (FROZEN_*) servent de fallback et de documentation ; en
 * mode catalogue, elles sont VÉRIFIÉES contre pg_proc/pg_class (dérive
 * interdite : tout écart = échec explicite).
 *
 * Usage : node scripts/check-rls-usage.mjs [--verbose]
 * (exécuté par la CI et par scripts/run-isolation-suites.sh avant les suites)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = join(ROOT, 'apps/api/src');

/**
 * Fonctions SECURITY DEFINER (documentation + fallback sans base). EN MODE
 * CATALOGUE, la liste effective est pg_proc WHERE prosecdef (schéma public) —
 * ces entrées doivent y EXISTER (sinon : échec explicite « dérive »).
 */
const FROZEN_SECURITY_DEFINER_FUNCTIONS = new Set([
  // 015 bootstrap auth
  'auth_get_memberships', 'auth_refresh_lookup', 'auth_get_device',
  // 016 invitations
  'invite_get_membership', 'invite_upsert_membership', 'invite_accept',
  // 017 séquence de référence enfants
  'next_org_sequence',
  // 024 webhook paiement + cycle de vie jobs
  'billing_webhook_apply', 'jobs_claim_next', 'jobs_finish',
  // 025 login parent
  'auth_parent_lookup_by_phone',
  // 029/032/035/036 console support
  'support_global_search', 'support_list_jobs', 'support_retry_job',
  'support_list_flags', 'support_set_flag', 'support_pilot_summary',
  // 034 rétention
  'retention_purge_logs',
  // 040 multi-rôles
  'auth_user_roles',
  // 042 drain notifications
  'notif_queue_claim', 'notif_queue_finish',
  // 046 garde DPIA
  'privacy_approved_dpia_exists',
  // 047 purge vidéo
  'video_clips_expired', 'video_clips_delete_purged',
  // 050 métriques globales /metrics
  'metrics_global_counts',
  // 051 expiration paiements pending SATIM (worker, job global)
  // 052 (CREATE OR REPLACE de 024/039 : billing_webhook_apply inchangée de nom)
  'payments_expire_pending',
]);

/**
 * Tables SYSTÈME (SANS RLS — CROISÉ avec pg_class en mode catalogue : chaque
 * entrée doit exister avec relrowsecurity = false) autorisées via pool brute,
 * avec justification :
 * - users / sessions / otp_codes : bootstrap auth AVANT pose du contexte
 *   tenant (login, refresh, OTP) — RLS absente par conception, l'isolation
 *   est assurée par les clauses WHERE (email, id de session…) ;
 * - organizations / roles / permissions / role_permissions : annuaire et
 *   enregistrement (pré-tenant) ;
 * - compliance_rules / compliance_rule_sets : référentiel global ;
 * - audit_logs / data_access_logs : INSERT append-only (jamais de SELECT
 *   tenant via pool brute) — l'audit ne doit pas faire échouer le métier ;
 * - schema_migrations : infra.
 */
const FROZEN_SYSTEM_TABLES = new Set([
  'users', 'sessions', 'otp_codes',
  'organizations', 'roles', 'permissions', 'role_permissions',
  'compliance_rules', 'compliance_rule_sets',
  'audit_logs', 'data_access_logs',
  'schema_migrations',
]);

/** Extrait le littéral SQL (backtick) qui suit un appel pool.query(. */
function extractSql(source, fromIndex) {
  const tick = source.indexOf('`', fromIndex);
  if (tick === -1) return null;
  const end = source.indexOf('`', tick + 1);
  if (end === -1) return null;
  return source.slice(tick + 1, end);
}

/** Identifiants de tables/fonctions référencés par le SQL. */
function referencedTables(sql) {
  const tables = new Set();
  const patterns = [
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  }
  return tables;
}

/** Fonctions appelées (SELECT fn(…) / SELECT * FROM fn(…) / FROM fn(…)). */
function calledFunctions(sql) {
  const fns = new Set();
  const re = /(?:SELECT\s+(?:\*|(?:[a-z_][a-z0-9_.]*))\s+FROM\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) fns.add(m[1].toLowerCase());
  return fns;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Exceptions inline justifiées : un accès pool.query brut précédé (2 lignes
 * au-dessus maximum) d'un commentaire `rls-guard: allow <raison>` est admis.
 * La raison DOIT être explicite — ex. lecture d'un flag GLOBAL
 * (organization_id IS NULL) que la policy feature_flags_tenant rend visible
 * sans contexte tenant. Chaque exception est affichée et comptée.
 */
function inlineAllow(source, index) {
  const before = source.slice(Math.max(0, index - 600), index);
  const lines = before.split('\n');
  // Remonte au plus 5 lignes en arrière (sauf la ligne du statement lui-même)
  // tant que ce sont des commentaires.
  for (let i = lines.length - 2; i >= 0 && i >= lines.length - 7; i -= 1) {
    const l = lines[i].trim();
    const m = l.match(/rls-guard:\s*allow\s+(.+?)\s*(?:\*\/)?$/);
    if (m) return m[1].trim();
    if (l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.endsWith('*/') && !l.startsWith('/**')) break;
  }
  return null;
}

/**
 * MISSION P2 — dérive la whitelist du CATALOGUE réel :
 * - sdFunctions : fonctions SECURITY DEFINER du schéma public (pg_proc) ;
 * - catalogFunctions : TOUTES les fonctions du schéma public (pour détecter
 *   un appel pool.query à une fonction qui EXISTE mais n'est PAS SECURITY
 *   DEFINER — divergence explicite) ;
 * - croisement des listes figées contre le catalogue (dérive = échec).
 */
async function loadCatalog(verbose) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const procs = await client.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    `);
    const sdRows = await client.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
    `);
    const tables = await client.query(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    `);
    const divergences = [];
    for (const name of FROZEN_SECURITY_DEFINER_FUNCTIONS) {
      if (!sdRows.rows.some((r) => r.proname === name)) {
        divergences.push(`fonction figée « ${name} » absente du catalogue SECURITY DEFINER (pg_proc, public) — liste en dérive`);
      }
    }
    const tableRLS = new Map(tables.rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const name of FROZEN_SYSTEM_TABLES) {
      if (!tableRLS.has(name)) {
        divergences.push(`table système figée « ${name} » absente de pg_class (schéma public) — liste en dérive`);
      } else if (tableRLS.get(name)) {
        divergences.push(`table système figée « ${name} » a désormais la RLS ACTIVE (relrowsecurity=true) — l'accès pool brute n'est plus légitime`);
      }
    }
    if (divergences.length) {
      console.error('\n✗ GARDE ANTI-BYPASS RLS — DIVERGENCE catalogue/listes figées :');
      for (const d of divergences) console.error(`  ✗ ${d}`);
      console.error('Mettre à jour scripts/check-rls-usage.mjs (ou réparer le schéma) — jamais de dérive silencieuse.');
      process.exit(1);
    }
    if (verbose) {
      console.log(`  Catalogue : ${sdRows.rows.length} fonction(s) SECURITY DEFINER (public) ; ${tableRLS.size} table(s) vérifiée(s) contre pg_class.`);
      console.log('  Croisement listes figées ↔ catalogue : OK (aucune dérive).');
    }
    return {
      sdFunctions: new Set(sdRows.rows.map((r) => r.proname.toLowerCase())),
      catalogFunctions: new Set(procs.rows.map((r) => r.proname.toLowerCase())),
    };
  } finally {
    await client.end();
  }
}

const main = async () => {
  const verbose = process.argv.includes('--verbose');
  let sdFunctions = FROZEN_SECURITY_DEFINER_FUNCTIONS;
  let catalogFunctions = null;
  let mode = 'fallback';
  if (process.env.DATABASE_URL) {
    const catalog = await loadCatalog(verbose);
    sdFunctions = catalog.sdFunctions;
    catalogFunctions = catalog.catalogFunctions;
    mode = 'catalogue';
  } else {
    console.warn('⚠ GARDE ANTI-BYPASS RLS — MODE FALLBACK : DATABASE_URL absent.');
    console.warn('  Listes figées utilisées SANS vérification du catalogue réel (pg_proc/pg_class).');
    console.warn('  Configurer DATABASE_URL (job CI « database », runner d\'isolation) pour la vérification complète.');
  }

  const violations = [];
  const reviewed = [];

  for (const file of walk(API_SRC)) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');
    const poolRe = /(?:this\.)?pool\.query\s*(?:<[^>(]*>)?\s*\(/g;
    let m;
    while ((m = poolRe.exec(source)) !== null) {
      const line = source.slice(0, m.index).split('\n').length;
      // Client sous withTenantConnection : client.query, jamais pool.query —
      // tout pool.query EST hors contexte tenant par construction.
      const allowReason = inlineAllow(source, m.index);
      const sql = extractSql(source, m.index + m[0].length - 1);
      if (sql === null) {
        violations.push(`${rel}:${line} — pool.query SANS littéral SQL statique (SQL dynamique interdit : non auditable)`);
        continue;
      }
      const tables = referencedTables(sql);
      const allCalled = [...calledFunctions(sql)];
      const fns = allCalled.filter((f) => sdFunctions.has(f));
      // MISSION P2 : fonction appelée via pool brute qui EXISTE dans le
      // catalogue public SANS être SECURITY DEFINER → divergence explicite.
      const nonSdRealFns = catalogFunctions
        ? allCalled.filter((f) => catalogFunctions.has(f) && !sdFunctions.has(f))
        : [];
      const nonSystem = [...tables].filter((t) => !FROZEN_SYSTEM_TABLES.has(t));
      const fnCallsOnly = fns.length > 0 && nonSystem.every((t) => fns.includes(t) || sql.includes(`FROM ${t}(`));
      if (allowReason !== null) {
        reviewed.push(`${rel}:${line} — OK (EXCEPTION inline : ${allowReason})`);
      } else if (nonSdRealFns.length > 0) {
        violations.push(
          `${rel}:${line} — DIVERGENCE : fonction(s) ${nonSdRealFns.join(', ')} appelée(s) via pool brute EXISTENT dans le catalogue (pg_proc public) SANS être SECURITY DEFINER — vérifier le mode de sécurité (dérive catalogue)`,
        );
      } else if (nonSystem.length === 0 || fnCallsOnly) {
        const why = fns.length ? `SECURITY DEFINER ${fns.join(',')} (catalogue=${mode})` : `table(s) système ${[...tables].join(',')} (aucune table tenant)`;
        reviewed.push(`${rel}:${line} — OK (${why})`);
      } else {
        violations.push(
          `${rel}:${line} — pool.query brut sur table(s) TENANT hors withTenantConnection : ${nonSystem.join(', ')} ` +
          `(SQL: ${sql.replace(/\s+/g, ' ').slice(0, 90)}…)`,
        );
      }
    }
  }

  if (verbose) {
    console.log(`Mode : ${mode === 'catalogue' ? 'CATALOGUE (pg_proc/pg_class, DATABASE_URL)' : 'FALLBACK (listes figées)'} — accès pool.query bruts revus : ${reviewed.length}`);
    for (const r of reviewed) console.log(`  ✓ ${r}`);
  }

  if (violations.length) {
    console.error(`\n✗ GARDE ANTI-BYPASS RLS : ${violations.length} accès(s) pool.query brut(s) ILLÉGAL(AUX) :`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    console.error('\nTout accès à une table tenant DOIT passer par TenantContextService.withTenantConnection,');
    console.error('ou par une fonction SECURITY DEFINER du catalogue (pg_proc WHERE prosecdef, schéma public).');
    process.exit(1);
  }
  console.log(`✓ Garde anti-bypass RLS (${mode}) : ${reviewed.length} accès pool.query brut(s) tous conformes (SECURITY DEFINER du catalogue ou tables système justifiées).`);
};

main().catch((error) => {
  console.error('✗ GARDE ANTI-BYPASS RLS — erreur interne :', error);
  process.exit(1);
});
