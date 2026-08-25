#!/usr/bin/env node
/**
 * GARDE ANTI-BYPASS RLS (audit, étape 4.1) — le bug P0 (UPDATE payments via
 * pool brute : 0 ligne silencieuse sous NOBYPASSRLS) serait mort né si ce
 * contrôle avait existé.
 *
 * Principe : dans apps/api/src, TOUT accès `pool.query` / `this.pool.query`
 * BRUT (hors withTenantConnection, qui pose app.tenant_id) ne peut porter QUE
 * sur :
 *   1. une FONCTION SECURITY DEFINER de la liste blanche ci-dessous (elle
 *      résout le tenant côté serveur — même pattern que le bootstrap auth) ;
 *   2. des TABLES SYSTÈME sans RLS, explicitement listées et justifiées.
 * Tout autre accès (table tenant directe : payments, video_clips, invoices,
 * children…) est une VIOLATION → le script ÉCHOUE (exit 1).
 *
 * Usage : node scripts/check-rls-usage.mjs   (exécuté par la CI et par
 * scripts/run-isolation-suites.sh avant les suites).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = join(ROOT, 'apps/api/src');

/**
 * Fonctions SECURITY DEFINER autorisées via pool brute (la fonction résout
 * le tenant serveur ; références = migrations / helpers de test).
 */
const SECURITY_DEFINER_FUNCTIONS = new Set([
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
  'payments_expire_pending',
]);

/**
 * Tables SYSTÈME (SANS RLS — vérifié sur le schéma : SELECT relname FROM
 * pg_class WHERE relrowsecurity = false) autorisées via pool brute, avec
 * justification :
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
const SYSTEM_TABLES = new Set([
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
  // Le littéral doit commencer juste après la parenthèse (espaces/génériques tolérés).
  const between = source.slice(fromIndex, tick);
  if (!/^\s*[^`]*?\(\s*$/.test(between.replace(/<[^(]*>/, ''))) {
    // entre la parenthèse et le backtick il peut y avoir des sauts de ligne — ok
  }
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

/** Fonctions SECURITY DEFINER appelées (SELECT fn(…) / SELECT * FROM fn(…)). */
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

const violations = [];
const reviewed = [];

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
    const fns = [...calledFunctions(sql)].filter((f) => SECURITY_DEFINER_FUNCTIONS.has(f));
    // Autorisé si : uniquement des tables système, OU au moins une fonction
    // SECURITY DEFINER et AUCUNE table tenant directe hors fonction,
    // OU exception inline justifiée (rls-guard: allow <raison>).
    const nonSystem = [...tables].filter((t) => !SYSTEM_TABLES.has(t));
    const fnCallsOnly = fns.length > 0 && nonSystem.every((t) => fns.includes(t) || sql.includes(`FROM ${t}(`));
    if (allowReason !== null) {
      reviewed.push(`${rel}:${line} — OK (EXCEPTION inline : ${allowReason})`);
    } else if (nonSystem.length === 0 || fnCallsOnly) {
      const why = fns.length ? `SECURITY DEFINER ${fns.join(',')}` : `table(s) système ${[...tables].join(',')} (aucune table tenant)`;
      reviewed.push(`${rel}:${line} — OK (${why})`);
    } else {
      violations.push(
        `${rel}:${line} — pool.query brut sur table(s) TENANT hors withTenantConnection : ${nonSystem.join(', ')} ` +
        `(SQL: ${sql.replace(/\s+/g, ' ').slice(0, 90)}…)`,
      );
    }
  }
}

if (process.argv.includes('--verbose')) {
  console.log(`Accès pool.query bruts revus : ${reviewed.length}`);
  for (const r of reviewed) console.log(`  ✓ ${r}`);
}

if (violations.length) {
  console.error(`\n✗ GARDE ANTI-BYPASS RLS : ${violations.length} accès(s) pool.query brut(s) ILLÉGAL(AUX) :`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error('\nTout accès à une table tenant DOIT passer par TenantContextService.withTenantConnection,');
  console.error('ou par une fonction SECURITY DEFINER whitelistée (voir scripts/check-rls-usage.mjs).');
  process.exit(1);
}
console.log(`✓ Garde anti-bypass RLS : ${reviewed.length} accès pool.query brut(s) tous conformes (SECURITY DEFINER ou tables système justifiées).`);
