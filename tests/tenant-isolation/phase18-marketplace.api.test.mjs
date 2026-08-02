#!/usr/bin/env node
/**
 * Phase 18 (roadmap v2) — marketplace / annuaire public, sur PostgreSQL réel
 * avec le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. flag marketplace off → liste vide (défaut) ;
 *   2. flag on → seules les organisations opt-in (settings.public_listing)
 *      sont listées ; les non-opt-in sont exclues ;
 *   3. le listing est PUBLIC (200 sans JWT) et ne contient AUCUNE donnée
 *      sensible (ni children, ni emails internes) ;
 *   4. le nom public (public_name) est utilisé s'il existe ;
 *   5. une organisation désactivée (is_active=false) n'apparaît pas même
 *      opt-in ;
 *   6. l'endpoint reste public après activation (aucun guard).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API compilée (dist/).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  const tag = `mk-${randomUUID().slice(0, 8)}`;

  try {
    // ── 1. Flag off → vide ─────────────────────────────────────────────────
    console.log('\n1) Flag marketplace désactivé (défaut du seed)');
    const off = await fetch(`${base}/marketplace`);
    const offB = await off.json();
    ok('Liste publique → 200 vide (flag off)', off.status === 200 && Array.isArray(offB) && offB.length === 0, JSON.stringify(offB).slice(0, 100));

    // Données : opt-in, non-opt-in, opt-in inactif
    await db.query(
      `INSERT INTO organizations(slug,name_fr,wilaya,is_active,settings) VALUES
       ($1,'Crèche Publique','31',true,$4::jsonb),
       ($2,'Crèche Privée','16',true,'{}'::jsonb),
       ($3,'Crèche Inactive','19',false,$5::jsonb)`,
      [`${tag}-pub`, `${tag}-priv`, `${tag}-inactive`,
        JSON.stringify({ public_listing: true, public_name: 'La Petite Étoile', public_description: 'Crèche bilingue' }),
        JSON.stringify({ public_listing: true, public_name: 'Fantôme' })],
    );

    // ── 2/3/4/5. Flag on → opt-in uniquement, sans données sensibles ───────
    console.log('\n2-5) Flag activé : opt-in uniquement, aucune donnée sensible');
    await db.query(`INSERT INTO feature_flags(flag_key,organization_id,is_enabled) VALUES('marketplace',NULL,true)`);
    const on = await fetch(`${base}/marketplace`);
    const onB = await on.json();
    ok('Listing → 200 (public, sans JWT)', on.status === 200);
    ok('Seule l\'opt-in active est listée (1 item)', Array.isArray(onB) && onB.length === 1, JSON.stringify(onB).slice(0, 150));
    ok('La non-opt-in est exclue', !onB.some((x) => x.slug === `${tag}-priv`));
    ok('L\'opt-in inactive est exclue', !onB.some((x) => x.slug === `${tag}-inactive`));
    ok('public_name utilisé (La Petite Étoile)', onB[0]?.public_name === 'La Petite Étoile', JSON.stringify(onB[0]));
    const s = JSON.stringify(onB);
    const item = onB[0] ?? {};
    ok('Aucune donnée sensible (children/password/email interne)',
      !s.includes('children') && !s.includes('password') && (item.public_email == null) && (item.public_phone == null),
      s.slice(0, 200));

    // ── 6. Public après activation ──────────────────────────────────────────
    console.log('\n6) Endpoint toujours public');
    const again = await fetch(`${base}/marketplace`);
    ok('Second appel sans JWT → 200 (aucun guard)', again.status === 200);
  } finally {
    try {
      await db.query(`DELETE FROM feature_flags WHERE flag_key='marketplace' AND organization_id IS NULL`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'mk-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase18 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 18 marketplace : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 18 marketplace validée (6 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
