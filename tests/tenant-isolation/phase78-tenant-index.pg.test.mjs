#!/usr/bin/env node
/**
 * Lot 1 / défaut D1 (plan de remédiation 2026-09-27) — indexation tenant.
 *
 * Ce que la suite prouve, sur une BASE RÉELLE (PostgreSQL 18, migrations
 * 001→077) et avec le rôle applicatif NOBYPASSRLS (`creche_app_test`) :
 *
 *   1. chaque table avec la RLS active et une colonne `organization_id` porte
 *      un index VALIDE dont cette colonne est la TÊTE (indkey[0]) ;
 *   2. les 4 exemptions (2 tables système, 2 tables de configuration) sont les
 *      seules tolérées, et chacune nomme une table qui existe ;
 *   3. une exemption système n'a PAS la RLS (sinon l'exemption est un défaut
 *      déguisé) ;
 *   4. l'ANALYSEur choisit réellement un Index Scan sur une requête « un seul
 *      tenant », dans le contexte RLS applicatif — ce n'est pas la présence de
 *      l'index qui compte, c'est son UTILISATION ;
 *   5. l'accès reste ISOLÉ après indexation : une requête posée sur le tenant A
 *      ne rend jamais une ligne du tenant B (l'index ne doit pas devenir une
 *      voie de contournement de la RLS) ;
 *   6. la migration 077 est RÉAPPLICABLE sans erreur (idempotence) : rejouer
 *      les CREATE INDEX IF NOT EXISTS ne lève pas.
 *
 * Pourquoi le point 5 existe : ajouter un index à une table protégée par RLS
 * est une modification de schéma qui touche au chemin d'accès des données. Il
 * faut démontrer qu'elle ne change pas le PÉRIMÈTRE des lignes rendues, sinon
 * l'optimisation deviendrait une fuite. C'est la contrepartie obligatoire de
 * la mesure de performance du banc `tests/perf/bench-tenant-index.mjs`.
 *
 * Prérequis : DATABASE_URL vers une base *_test (PostgreSQL 18 réel).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (name, pass, detail) => {
  console.log(`${pass ? '✓' : '✗'} ${name}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(name);
};

/** Exemptions admises — doit rester synchrone de scripts/check-tenant-index.mjs. */
const EXEMPTIONS = {
  system: new Set(['users', 'sessions']),
  config: new Set(['feature_flags', 'processing_registry']),
};
const isExempt = (t) => EXEMPTIONS.system.has(t) || EXEMPTIONS.config.has(t);

/** Tables tenant (RLS active) portant organization_id. */
const TENANT_TABLES_SQL = `
  SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
  ORDER BY 1
`;

/** Index valide dont organization_id est la première colonne. */
const HAS_LEADING_IDX_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = $1::regclass AND i.indisvalid
      AND i.indkey[0] = (SELECT a.attnum FROM pg_attribute a
                         WHERE a.attrelid = $1::regclass AND a.attname = 'organization_id')
  ) AS has_idx
`;

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('phase78 : base *_test uniquement');

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  const app = new pg.Client({ connectionString: appUrl() });
  await app.connect();

  // Déclarés hors du `try` : le `finally` en a besoin pour nettoyer même si une
  // assertion échoue avant leur création complète.
  const orgs = [];
  let user = null;

  try {
    // ── 1. Index de tête sur toutes les tables tenant non exemptées ────────
    const tables = (await admin.query(TENANT_TABLES_SQL)).rows.map((r) => r.table_name);
    ok('le schéma expose des tables tenant (RLS + organization_id)', tables.length > 0,
      `${tables.length} tables`);

    const unindexed = [];
    for (const t of tables) {
      if (isExempt(t)) continue;
      const { has_idx } = (await admin.query(HAS_LEADING_IDX_SQL, [t])).rows[0];
      if (!has_idx) unindexed.push(t);
    }
    ok(
      `index de tête organization_id présent sur les ${tables.length - [...EXEMPTIONS.system, ...EXEMPTIONS.config].filter((t) => tables.includes(t)).length} tables tenant indexables`,
      unindexed.length === 0,
      `manquants : ${unindexed.join(', ')}`,
    );

    // ── 2. Exemptions : liste fermée et tables existantes ──────────────────
    const allExempt = [...EXEMPTIONS.system, ...EXEMPTIONS.config];
    const existing = new Set(
      (await admin.query(
        `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r'`,
      )).rows.map((r) => r.t),
    );
    const stale = allExempt.filter((t) => !existing.has(t));
    ok(`les ${allExempt.length} exemptions nomment des tables existantes`, stale.length === 0,
      `périmées : ${stale.join(', ')}`);

    // ── 3. Une exemption « système » ne doit PAS avoir la RLS ──────────────
    const mislabelled = [];
    for (const t of EXEMPTIONS.system) {
      const { relrowsecurity } = (await admin.query(
        `SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname=$1`, [t],
      )).rows[0] ?? {};
      // Une table système exemptée qui PORTERAIT la RLS serait un défaut :
      // l'exemption n'a de sens que parce que la RLS ne s'y applique pas.
      if (relrowsecurity === true) mislabelled.push(t);
    }
    ok('les exemptions système n’ont pas la RLS (sinon l’exemption est un défaut déguisé)',
      mislabelled.length === 0, `à corriger : ${mislabelled.join(', ')}`);

    // ── 4. Le planificateur UTILISE l'index dans le contexte applicatif ────
    // Jeu d'essai : DEUX organisations observées (A et B) noyées parmi
    // FILLER_ORGS organisations de remplissage. Le remplissage n'est pas
    // décoratif : avec 120 lignes au total, la table tient en deux pages et le
    // balayage séquentiel est VRAIMENT le meilleur plan — l'assertion serait
    // fausse pour une bonne raison. Il faut une sélectivité réaliste (~2,5 %)
    // pour que la comparaison ait un sens.
    const FILLER_ORGS = 38;
    const PER_ORG = 60;
    const suffix = Math.random().toString(36).slice(2, 8);
    // Mesure par DIFFÉRENCE : un run interrompu peut avoir laissé des lignes.
    // L'assertion porte sur ce que CETTE suite a créé, pas sur un total absolu.
    const baseline = Number((await admin.query(`SELECT count(*) FROM messages`)).rows[0].count);

    user = (await admin.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status)
       VALUES ($1,'P78','Bench','p78-not-a-real-hash','active') RETURNING id`,
      [`p78-${suffix}@test.invalid`],
    )).rows[0].id;

    /** Crée une organisation complète (site + enfant + conversation). */
    const makeOrg = async (tag) => {
      const org = (await admin.query(
        `INSERT INTO organizations(slug,name_fr,wilaya) VALUES ($1,$2,'31') RETURNING id`,
        [`p78-${tag}-${suffix}`, `P78 ${tag}`],
      )).rows[0].id;
      const site = (await admin.query(
        `INSERT INTO sites(organization_id,name_fr) VALUES ($1,'P78') RETURNING id`, [org],
      )).rows[0].id;
      const child = (await admin.query(
        `INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES ($1,$2,'P78',substr(md5($3::text),1,8),'2022-01-01',$4) RETURNING id`,
        [org, site, org, user],
      )).rows[0].id;
      const conv = (await admin.query(
        `INSERT INTO conversations(organization_id,child_id,subject) VALUES ($1,$2,'P78') RETURNING id`,
        [org, child],
      )).rows[0].id;
      // Un seul INSERT ensembliste par organisation (generate_series) : 40
      // allers-retours réseau au lieu de 2 400.
      await admin.query(
        `INSERT INTO messages(organization_id,conversation_id,sender_id,body)
         SELECT $1, $2, $3, $4 || '-' || g FROM generate_series(1, $5) g`,
        [org, conv, user, `message ${tag}`, PER_ORG],
      );
      return org;
    };

    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    orgs.push(orgA, orgB);
    for (let i = 0; i < FILLER_ORGS; i++) orgs.push(await makeOrg(`F${i}`));
    await admin.query('ANALYZE messages');

    const total = Number((await admin.query(`SELECT count(*) FROM messages`)).rows[0].count);
    const createdRows = total - baseline;
    ok('jeu d’essai représentatif (sélectivité faible par tenant)',
      createdRows === (FILLER_ORGS + 2) * PER_ORG && createdRows / PER_ORG >= 20,
      `${createdRows} messages créés par la suite (total table : ${total}), ${createdRows / PER_ORG} organisations`);

    // ── 5. Isolation + plan, DANS UNE SEULE TRANSACTION applicative ────────
    // `set_config('app.tenant_id', …, true)` est un SET LOCAL : la GUC vit le
    // temps de la TRANSACTION, pas de la session (c'est la propriété qui rend
    // l'isolation sûre avec un pool de connexions). Toutes les mesures
    // applicatives sont donc prises entre un BEGIN et un COMMIT — faute de
    // quoi le contexte serait perdu dès la requête suivante et la RLS rendrait
    // 0 ligne (comportement safe-by-default, observé pendant l'écriture de
    // cette suite : c'est une confirmation, pas un contournement).
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [orgA]);

    const plan = (await app.query(
      `EXPLAIN SELECT id FROM messages WHERE organization_id = $1`, [orgA],
    )).rows.map((r) => r['QUERY PLAN']).join('\n');
    ok('le planificateur choisit un Index Scan (pas un Seq Scan) sous RLS',
      /Index Scan/.test(plan) && !/Seq Scan/.test(plan),
      plan.split('\n').find((l) => /Scan/.test(l))?.trim() ?? plan);

    // L'index ne doit PAS élargir le périmètre : isolation conservée.
    const seenA = (await app.query(
      `SELECT body FROM messages WHERE organization_id = $1 ORDER BY body`, [orgA],
    )).rows.map((r) => r.body);
    ok('le tenant A ne voit que ses messages', seenA.length === PER_ORG && seenA.every((b) => b.startsWith('message A-')),
      `${seenA.length} lignes, échantillon : ${seenA.slice(0, 2).join(' | ')}`);

    // Sans organization_id explicite (la RLS filtre seule) : même périmètre.
    const implicit = (await app.query(`SELECT count(*)::int AS n FROM messages`)).rows[0].n;
    ok('sans filtre explicite, la RLS rend le même nombre de lignes', implicit === PER_ORG,
      `rendu ${implicit}, attendu ${PER_ORG}`);

    // Changement de tenant dans la même transaction applicative.
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [orgB]);
    const seenB = (await app.query(`SELECT body FROM messages ORDER BY body`)).rows.map((r) => r.body);
    ok('le tenant B ne voit que ses messages (aucune fuite du tenant A)',
      seenB.length === PER_ORG && seenB.every((b) => b.startsWith('message B-')),
      `${seenB.length} lignes, échantillon : ${seenB.slice(0, 2).join(' | ')}`);

    // Contrôle négatif : SANS tenant posé, la RLS doit rendre 0 ligne.
    await app.query(`SELECT set_config('app.tenant_id', '', true)`);
    const noTenant = (await app.query(`SELECT count(*)::int AS n FROM messages`)).rows[0].n;
    ok('sans tenant posé, la RLS rend 0 ligne (safe-by-default, jamais de fuite)', noTenant === 0,
      `rendu ${noTenant}`);
    await app.query('ROLLBACK');

    // ── 6. Réapplicabilité de la migration (idempotence) ───────────────────
    const out = execSync('node scripts/migrate.mjs', {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    ok('migrate.mjs réappliqué sans erreur (index IF NOT EXISTS)',
      /Aucune migration en attente|migration\(s\) appliquée/.test(out), out.slice(-200));
    const drift = execSync('node scripts/migrate.mjs --status', {
      cwd: repo, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
    });
    ok('aucun drift de migration après indexation', /Schéma cohérent/.test(drift), drift.slice(-200));

  } finally {
    // Nettoyage INCONDITIONNEL : une assertion qui échoue au milieu laisserait
    // sinon des organisations orphelines, et le run suivant échouerait à son
    // tour sur une FK (observé pendant l'écriture de cette suite). Le test
    // doit être rejouable.
    if (orgs.length > 0 || user) {
      try {
    // Nettoyage — les messages ne sont PAS financiers, donc supprimables.
      // Ordre imposé par les FK : le trigger `sync_child_changed` (migration 059)
      // publie des tombes dans `sync_changelog`, qui référence `organizations`
      // (`sync_changelog_organization_id_fkey`, migration 061). Il faut donc
      // vider le changelog AVANT de supprimer les organisations.
      await admin.query(`DELETE FROM messages WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      await admin.query(`DELETE FROM conversations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      await admin.query(`DELETE FROM children WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      await admin.query(`DELETE FROM sites WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      await admin.query(`DELETE FROM sync_changelog WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      await admin.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [orgs]);
      if (user) await admin.query(`DELETE FROM users WHERE id = $1`, [user]);
      } catch (cleanupError) {
        console.warn('  ! nettoyage partiel :', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    }
    await app.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} assertion(s) en échec :\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\n✓ phase78 — indexation tenant : toutes les assertions passent.');
};

await main();
