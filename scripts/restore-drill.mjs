#!/usr/bin/env node
/**
 * P0-2 (audit continu 2026-09) — Preuve automatisée sauvegarde → restauration.
 *
 * « Une sauvegarde non restaurée n'est pas une sauvegarde. »
 *
 * Le drill rejoue le cycle complet SANS toucher à la base source :
 *   1. scripts/backup.sh contre DATABASE_URL (archive chiffrée + sha256,
 *      avec copie hors site simulée) — même script qu'en production ;
 *   2. vérification d'intégrité sha256 ;
 *   3. déchiffrement avec une MAUVAISE passphrase → doit échouer (preuve
 *      que l'archive est réellement chiffrée) ;
 *   4. restauration gpg → gunzip → psql (pipeline exact du runbook) dans
 *      une base dédiée `restore_drill_target` créée pour l'occasion ;
 *   5. comparaison source/restauré : comptes de lignes des tables majeures,
 *      politiques RLS, fonctions SECURITY DEFINER du bootstrap ;
 *   6. nettoyage de la base de restauration.
 *
 * Prérequis : gpg, gzip, pg_dump et psql dans le PATH (ou PG_BIN).
 * Garde-fou : la base source doit être *_test (ou DRILL_ALLOW_NON_TEST=1) —
 * jamais de pg_dump accidentel d'une base de production depuis la CI.
 *
 * Environnement requis : DATABASE_URL, BACKUP_PASSPHRASE.
 * Sortie non nulle au moindre écart (exit code 1).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const SOURCE_URL = process.env.DATABASE_URL;
const PASSPHRASE = process.env.BACKUP_PASSPHRASE;
const TARGET_DB = 'restore_drill_target';
if (!SOURCE_URL || !PASSPHRASE) {
  console.error('✗ DATABASE_URL et BACKUP_PASSPHRASE requis');
  process.exit(1);
}
const srcUrl = new URL(SOURCE_URL);
if (!srcUrl.pathname.endsWith('_test') && process.env.DRILL_ALLOW_NON_TEST !== '1') {
  console.error(`✗ Base source ${srcUrl.pathname} : le drill exige une base *_test (ou DRILL_ALLOW_NON_TEST=1)`);
  process.exit(1);
}
const targetUrl = new URL(SOURCE_URL);
targetUrl.pathname = `/${TARGET_DB}`;

const work = mkdtempSync(join(tmpdir(), 'restore-drill-'));
let failed = false;
let currentStep = 'préparation';
const step = (label) => console.log(`\n── ${label}`);

function binOrNull(name) {
  // Binaires embedded-postgres si la plateforme les embarque, sinon PATH.
  try {
    const scope = join(process.cwd(), 'node_modules', '@embedded-postgres');
    for (const entry of readdirSync(scope)) {
      const candidate = join(scope, entry, 'native', 'bin', name);
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* rien d'embarqué */ }
  return name; // résolu via PATH ; le premier appel échouera lisiblement
}

function probe(bin) {
  return spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
}

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

try {
  // ── 0. Outillage ─────────────────────────────────────────────────────────
  const pgDump = binOrNull('pg_dump');
  const psql = binOrNull('psql');
  if (!probe(pgDump)) throw new Error('pg_dump introuvable (PATH ou embedded-postgres)');
  if (!probe(psql)) throw new Error('psql introuvable (PATH ou embedded-postgres)');
  const dumpMajor = Number(String(spawnSync(pgDump, ['--version'], { encoding: 'utf8' }).stdout).match(/(\d+)/)?.[1] ?? 0);
  const serverMajor = await withClient(SOURCE_URL, async (c) => {
    const res = await c.query('SHOW server_version');
    return Number(String(res.rows[0].server_version).split('.')[0]);
  });
  if (!dumpMajor || dumpMajor < serverMajor) {
    throw new Error(`pg_dump v${dumpMajor} < serveur PostgreSQL v${serverMajor} : client trop ancien`);
  }
  console.log(`✓ Outillage : pg_dump v${dumpMajor}, psql présents ; serveur v${serverMajor}`);
  currentStep = '1/6 backup.sh';

  // ── 1. Sauvegarde réelle (même script que la production) ────────────────
  step('1/6 Sauvegarde chiffrée via scripts/backup.sh');
  const backupDir = join(work, 'backups');
  const offsiteDir = join(work, 'offsite');
  const backup = spawnSync('bash', ['scripts/backup.sh'], {
    env: {
      ...process.env,
      DATABASE_URL: SOURCE_URL,
      BACKUP_DIR: backupDir,
      BACKUP_PASSPHRASE: PASSPHRASE,
      BACKUP_OFFSITE_DIR: offsiteDir,
    },
    encoding: 'utf8',
  });
  if (backup.status !== 0) {
    console.error(`✗ backup.sh en échec :\n${backup.stdout}\n${backup.stderr}`);
    process.exit(1);
  }
  const archives = readdirSync(join(backupDir, 'daily')).filter(f => f.endsWith('.sql.gz.gpg'));
  if (archives.length === 0) throw new Error('aucune archive produite');
  const archive = join(backupDir, 'daily', archives[0]);
  console.log(`✓ Archive produite : ${archives[0]}`);
  const offsiteCopy = join(offsiteDir, 'daily', archives[0]);
  if (!existsSync(offsiteCopy)) throw new Error('copie hors site absente (BACKUP_OFFSITE_DIR non honoré)');
  console.log('✓ Copie hors site présente');
  currentStep = '2/6 sha256';

  // ── 2. Intégrité sha256 ───────────────────────────────────────────────────
  step('2/6 Intégrité SHA-256');
  const sha = spawnSync('sha256sum', ['-c', `${archives[0]}.sha256`], { cwd: join(backupDir, 'daily'), encoding: 'utf8' });
  if (sha.status !== 0) throw new Error(`sha256sum -c en échec : ${sha.stdout}${sha.stderr}`);
  console.log('✓ Empreinte vérifiée');
  currentStep = '3/6 preuve de chiffrement';

  // ── 3. Preuve de chiffrement (mauvaise passphrase refusée) ───────────────
  step('3/6 Preuve de chiffrement (mauvaise passphrase)');
  const wrong = spawnSync('gpg', ['--batch', '--decrypt', '--passphrase', 'WRONG-' + PASSPHRASE, archive], { stdio: 'pipe' });
  if (wrong.status === 0) throw new Error('le déchiffrement avec une mauvaise passphrase a RÉUSSI — chiffrement invalide');
  console.log('✓ Déchiffrement refusé avec une mauvaise passphrase');
  currentStep = '4/6 restauration';

  // ── 4. Restauration (pipeline exact du runbook) ──────────────────────────
  step('4/6 Restauration dans une base dédiée');
  await withClient(SOURCE_URL, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`);
    await c.query(`CREATE DATABASE ${TARGET_DB}`);
  });
  const restore = spawnSync('bash', ['-c',
    'gpg --batch --decrypt --passphrase "$PASSPHRASE" "$ARCHIVE" | gunzip | "$PSQL" "$TARGET" -v ON_ERROR_STOP=1 --quiet'], {
    env: { PASSPHRASE, ARCHIVE: archive, PSQL: psql, TARGET: targetUrl.toString() },
    encoding: 'utf8',
  });
  if (restore.status !== 0) throw new Error(`restauration en échec :\n${restore.stdout}\n${restore.stderr}`);
  console.log('✓ Restauration terminée');
  currentStep = '5/6 comparaison';

  // ── 5. Comparaison source ↔ restauré ─────────────────────────────────────
  step('5/6 Comparaison source ↔ restauré');
  const tables = [
    'organizations', 'users', 'memberships', 'roles', 'children', 'guardians',
    'invoices', 'payments', 'sessions', 'audit_logs', 'consent_records', 'jobs',
  ];
  for (const table of tables) {
    const [src, dst] = [
      await withClient(SOURCE_URL, (c) => c.query(`SELECT count(*)::int AS n FROM ${table}`)).then(r => r.rows[0].n),
      await withClient(targetUrl.toString(), (c) => c.query(`SELECT count(*)::int AS n FROM ${table}`)).then(r => r.rows[0].n),
    ];
    if (src !== dst) throw new Error(`écart de restauration ${table} : source=${src} restauré=${dst}`);
    console.log(`✓ ${table} : ${src} lignes identiques`);
  }
  const [srcPolicies, dstPolicies] = [
    await withClient(SOURCE_URL, (c) => c.query('SELECT count(*)::int AS n FROM pg_policies')).then(r => r.rows[0].n),
    await withClient(targetUrl.toString(), (c) => c.query('SELECT count(*)::int AS n FROM pg_policies')).then(r => r.rows[0].n),
  ];
  if (srcPolicies !== dstPolicies) throw new Error(`politiques RLS : source=${srcPolicies} restauré=${dstPolicies}`);
  console.log(`✓ ${dstPolicies} politiques RLS restaurées`);
  for (const fn of ['auth_get_memberships(uuid)', 'invite_accept(uuid, uuid)', 'billing_webhook_apply(uuid, text, numeric, text, timestamptz, text)']) {
    const found = await withClient(targetUrl.toString(), (c) => c.query('SELECT to_regprocedure($1) AS fn', [fn])).then(r => r.rows[0].fn);
    if (!found) throw new Error(`fonction SECURITY DEFINER manquante après restauration : ${fn}`);
  }
  console.log('✓ Fonctions SECURITY DEFINER du bootstrap présentes');
  currentStep = '6/6 synthèse/nettoyage';

  // ── 6. Synthèse + nettoyage ──────────────────────────────────────────────
  step('6/6 Synthèse');
  console.log('✓ DRILL OK : sauvegarde chiffrée vérifiée, restaurée et conforme à la source.');
} catch (error) {
  failed = true;
  const detail = String(error?.stack ?? error);
  console.error(`✗ DRILL EN ÉCHEC : ${detail}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Les logs bruts Actions ne sont pas toujours lisibles par l'agent —
    // l'annotation publie la cause complète via l'API check-runs.
    console.log(`::error title=Restore drill (P0-2) étape ${currentStep}::${detail.replace(/\r?\n/g, ' | ').slice(0, 900)}`);
  }
} finally {
  await withClient(SOURCE_URL, (c) => c.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`)).catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
