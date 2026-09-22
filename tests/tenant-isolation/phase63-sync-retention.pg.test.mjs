#!/usr/bin/env node
/**
 * Phase 63 (remédiation 2026-09-21, R11/F8) — purge cursor-aware des tables sync.
 *
 * Cas couverts :
 *   1. cursor minimum à 0 → la fonction NE purge rien (sécurité : un
 *      tenant sans cursors conserve tout) ;
 *   2. cursor = 5000, sync_changelog contient des lignes 1..10000 :
 *      après sync_retention_purge(1000), il reste 6001..10000
 *      (= lignes dont sync_seq ≥ 4000 = cursor_min - marge) ;
 *   3. un device avec cursor_value = 100 NE PEUT PAS se voir supprimer
 *      une ligne sous cursor_value (= sécurité replay : la marge protège
 *      les devices en cours de pull).
 *
 * Prérequis : PG18 réel, migrations 001→075.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl } from './helpers.mjs';

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

  const rng = randomUUID().slice(0, 8);
  const org = `sync-${rng}`;
  const orgId = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'R','31') RETURNING id`, [org])).rows[0].id;
  const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T','x','active') RETURNING id`, [`u-${rng}@x.dz`])).rows[0].id;
  const dev = (await db.query(`INSERT INTO devices(organization_id,name,device_fingerprint,platform) VALUES($1,'dev1','fp','ios') RETURNING id`, [orgId])).rows[0].id;

  try {
    // ── Cas 1 : aucun cursor → rien à purger
    await db.query(`INSERT INTO sync_changelog (organization_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'a',gen_random_uuid(),'e','{}'),($1,'a',gen_random_uuid(),'e','{}'),($1,'a',gen_random_uuid(),'e','{}')`, [orgId]);
    let n = await db.query(`SELECT sync_retention_purge(1000)`);
    const total1 = (n.rows || []).reduce((a, r) => a + Number(r.deleted_count), 0);
    ok('Cas 1 (aucun cursor → 0 suppression)', total1 === 0, `total=${total1}`);

    // ── Cas 2 : cursor = 5000, marge = 1000 → seuil = 4000 ; 6000 lignes
    //    doivent rester (sync_seq 4001..10000) ; 4000 doivent être purgées.
    // Créer un cursor.
    await db.query(`INSERT INTO sync_cursors (organization_id, device_id, cursor_value) VALUES ($1,$2,5000)`, [orgId, dev]);
    // Insérer 10 000 lignes dans sync_changelog — mais en une fois c'est
    // long : on s'appuie sur les 3 déjà insérées + on en ajoute 10 000.
    console.log('Insertion de 10000 lignes de sync_changelog (peut prendre 10s)...');
    await db.query(`
      INSERT INTO sync_changelog (organization_id, aggregate_type, aggregate_id, event_type, payload)
      SELECT $1, 'a', gen_random_uuid(), 'e', '{}' FROM generate_series(1, 10000)
    `, [orgId]);
    const before = (await db.query(`SELECT COUNT(*)::int AS n FROM sync_changelog WHERE organization_id=$1`, [orgId])).rows[0].n;
    ok('10 000+ lignes dans sync_changelog', before >= 10003, `n=${before}`);

    n = await db.query(`SELECT * FROM sync_retention_purge(1000)`);
    const purged = (n.rows || []).reduce((a, r) => a + Number(r.deleted_count), 0);
    const after = (await db.query(`SELECT COUNT(*)::int AS n FROM sync_changelog WHERE organization_id=$1`, [orgId])).rows[0].n;
    const deleted = before - after;
    console.log(`  Avant=${before}, purgées=${purged}, après=${after}`);
    // Attendu : après purge, il reste ~ 6000 lignes (= 10000 - 4000 supprimées,
    // plus les 3 initiales qui sont aussi supprimées). La marge (1000) protège
    // le device : cursor=5000, seuil = 5000-1000 = 4000 ; tout sync_seq < 4000
    // est purgé ; tout sync_seq >= 4000 reste.
    ok('Cas 2 : purge conforme au cursor + marge', Math.abs(deleted - 4000) <= 100 && after >= 6000, `deleted=${deleted}, after=${after}`);

    // ── Cas 3 : un device avec cursor faible (100) NE DOIT PAS se voir
    //    supprimer une ligne sous 100. La marge (1000) protège les pulls en
    //    cours : un device à cursor=100 ne purge rien sous 100-1000=-900 (i.e.
    //    rien).
    const dev2 = (await db.query(`INSERT INTO devices(organization_id,name,device_fingerprint,platform) VALUES($1,'dev2','fp2','ios') RETURNING id`, [orgId])).rows[0].id;
    await db.query(`INSERT INTO sync_cursors (organization_id, device_id, cursor_value) VALUES ($1,$2,100)`, [orgId, dev2]);
    // (Le MIN(cursor_value) sur le tenant est désormais min(5000, 100) = 100.
    // Le seuil = 100 - 1000 = -900. Donc AUCUNE ligne n'est purgée à partir
    // de maintenant : sync_seq >= 1 reste, sync_seq < 1 = rien.)
    const before3 = (await db.query(`SELECT COUNT(*)::int AS n FROM sync_changelog WHERE organization_id=$1`, [orgId])).rows[0].n;
    n = await db.query(`SELECT sync_retention_purge(1000)`);
    const after3 = (await db.query(`SELECT COUNT(*)::int AS n FROM sync_changelog WHERE organization_id=$1`, [orgId])).rows[0].n;
    ok('Cas 3 : device à cursor=100 ne perd rien (marge)', before3 === after3, `before=${before3}, after=${after3}`);
  } finally {
    try {
      await db.query(`DELETE FROM sync_changelog WHERE organization_id=$1`, [orgId]);
      await db.query(`DELETE FROM sync_cursors WHERE organization_id=$1`, [orgId]);
      await db.query(`DELETE FROM devices WHERE organization_id=$1`, [orgId]);
      await db.query(`DELETE FROM users WHERE email LIKE $1`, [`u-${rng}@x.dz`]);
      await db.query(`DELETE FROM organizations WHERE slug=$1`, [org]);
    } catch (e) {
      console.error('cleanup partiel :', e.message);
    }
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 63 sync-retention : ${failures.length} — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 63 sync-retention validée (R11) sur PostgreSQL réel.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
