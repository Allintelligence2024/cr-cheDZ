#!/usr/bin/env node
/**
 * Phase 62 (remédiation 2026-09-21, R15/F13) — verrouillage des courses de
 * paie finalisées (migration 072).
 *
 * Contexte : la facturation payée est verrouillée par le trigger C04 (invoices,
 * payments) — mais pas la paie. Un UPDATE/DELETE SQL direct pouvait muter un
 * run finalisé (total_gross, total_net, period_*), avec risque comptable.
 * R15 colmate en s'inspirant du pattern C04.
 *
 * Cas couverts :
 *   1. finalize un run (status='finalized', finalized_at=NOW()) ;
 *   2. UPDATE total_gross sur un run finalisé → PAYROLL_RUN_FINALIZED ;
 *   3. UPDATE total_net → PAYROLL_RUN_FINALIZED ;
 *   4. UPDATE period_year → PAYROLL_RUN_FINALIZED ;
 *   5. UPDATE status finalized → cancelled → OK (annulation comptable) ;
 *   6. UPDATE d'une entrée (payroll_entries) liée à un run finalisé →
 *      PAYROLL_ENTRY_FINALIZED ;
 *   7. DELETE d'un run finalisé → PAYROLL_RUN_FINALIZED ;
 *   8. UPDATE d'un run cancelled → PAYROLL_RUN_CANCELLED (annulé immuable) ;
 *   9. UPDATE d'une entrée liée à un run cancelled → PAYROLL_ENTRY_CANCELLED ;
 *  10. UPDATE d'une entrée d'un run NON finalisé → OK (régression négative).
 *
 * Prérequis : PostgreSQL réel, migrations 001→072 appliquées.
 * Rôle : on parle à la base en tant que `creche_app` (test_role configuré
 * par ensureAppRole) pour exercer les triggers tels qu'ils se déclencheront
 * en prod — pas en superuser.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

  // L'application (creche_app) est l'auteur réel des mutations en prod :
  // on bascule DATABASE_URL vers le rôle applicatif avant d'exécuter.
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();

  const rng = randomUUID().slice(0, 8);
  const org = `payrl-${rng}`;

  try {
    // ── 1. Préparer le terrain en tant que superuser (create org, roles,
    //       staff_profiles, users, sites). L'app role ne peut pas faire
    //       d'INSERT sur organizations (pas dans ses grants).
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const orgId = (await admin.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'R','31') RETURNING id`, [org])).rows[0].id;
    const siteId = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [orgId])).rows[0].id;
    const roomId = (await admin.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'S',10) RETURNING id`, [orgId, siteId])).rows[0].id;
    const userId = (await admin.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T','x','active') RETURNING id`, [`u-${rng}@x.dz`])).rows[0].id;
    const staffId = (await admin.query(`INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type,base_salary,is_active) VALUES($1,$2,'educator_qualified','2024-01-01','permanent',100000,true) RETURNING id`, [orgId, userId])).rows[0].id;
    await admin.end();

    // ── 2. On bascule en rôle applicatif (creche_app_test) — c'est le
    //       seul client des triggers en prod.
    const app = new pg.Client({ connectionString: appUrl() });
    await app.connect();
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [orgId]);

    // ── 3. RUN #1 : finalized (pour tester le verrouillage fort).
    let run1 = (await app.query(
      `INSERT INTO payroll_runs(organization_id,period_year,period_month,status,total_gross,total_net,generated_by)
       VALUES($1,2026,9,'draft',50000,50000,$2) RETURNING id, status, finalized_at`,
      [orgId, userId],
    )).rows[0];
    ok('Run #1 draft créé', run1.id && run1.status === 'draft', JSON.stringify(run1));

    run1 = (await app.query(
      `UPDATE payroll_runs SET status='finalized', finalized_at=NOW() WHERE id=$1 RETURNING id, status, finalized_at`,
      [run1.id],
    )).rows[0];
    ok('Run #1 finalisé', run1.status === 'finalized' && run1.finalized_at !== null, JSON.stringify(run1));

    // Entrée sur run #1.
    const entry1 = (await app.query(
      `INSERT INTO payroll_entries(organization_id,run_id,staff_id,user_id,period_year,period_month,gross_amount,deductions_amount,net_amount,status)
       VALUES($1,$2,$3,$4,2026,9,50000,0,50000,'paid') RETURNING id`,
      [orgId, run1.id, staffId, userId],
    )).rows[0];

    // ── 4. RUN #2 : qu'on bascule en cancelled (pour tester le verrouillage post-annulation).
    const run2 = (await app.query(
      `INSERT INTO payroll_runs(organization_id,period_year,period_month,status,total_gross,total_net,generated_by)
       VALUES($1,2026,10,'draft',30000,30000,$2) RETURNING id`,
      [orgId, userId],
    )).rows[0];
    await app.query(`UPDATE payroll_runs SET status='finalized', finalized_at=NOW() WHERE id=$1`, [run2.id]);
    await app.query(`UPDATE payroll_runs SET status='cancelled' WHERE id=$1`, [run2.id]);
    const entry2 = (await app.query(
      `INSERT INTO payroll_entries(organization_id,run_id,staff_id,user_id,period_year,period_month,gross_amount,deductions_amount,net_amount,status)
       VALUES($1,$2,$3,$4,2026,10,30000,0,30000,'paid') RETURNING id`,
      [orgId, run2.id, staffId, userId],
    )).rows[0];
    ok('Run #2 cancelled + entrée liée créés', run2.id && entry2.id, '');

    // ── 5. UPDATE total_gross/total_net/period_year sur run1 finalisé → PAYROLL_RUN_FINALIZED
    console.log('\n5) UPDATE total_gross/total_net/period_year sur run #1 finalisé → PAYROLL_RUN_FINALIZED');
    for (const col of ['total_gross', 'total_net', 'period_year']) {
      try {
        await app.query(`UPDATE payroll_runs SET ${col} = ${col} + 1 WHERE id=$1`, [run1.id]);
        ok(`UPDATE ${col} sur run finalisé est REFUSÉ`, false, `a renvoyé 0 ligne`);
      } catch (err) {
        ok(`UPDATE ${col} sur run finalisé → PAYROLL_RUN_FINALIZED`, /PAYROLL_RUN_FINALIZED/.test(err.message), err.message.slice(0, 120));
      }
    }

    // ── 6. UPDATE entry1 sur run1 finalisé → PAYROLL_ENTRY_FINALIZED
    console.log('\n6) UPDATE entry sur run #1 finalisé → PAYROLL_ENTRY_FINALIZED');
    try {
      await app.query(`UPDATE payroll_entries SET gross_amount=60000 WHERE id=$1`, [entry1.id]);
      ok('UPDATE entry sur run finalisé est REFUSÉ', false, 'a renvoyé 0 ligne');
    } catch (err) {
      ok('UPDATE entry sur run finalisé → PAYROLL_ENTRY_FINALIZED', /PAYROLL_ENTRY_FINALIZED/.test(err.message), err.message.slice(0, 120));
    }

    // ── 7. DELETE run1 finalisé → PAYROLL_RUN_FINALIZED
    console.log('\n7) DELETE run #1 finalisé → PAYROLL_RUN_FINALIZED');
    try {
      await app.query(`DELETE FROM payroll_runs WHERE id=$1`, [run1.id]);
      ok('DELETE run finalisé est REFUSÉ', false, 'a renvoyé 0 ligne');
    } catch (err) {
      ok('DELETE run finalisé → PAYROLL_RUN_FINALIZED', /PAYROLL_RUN_FINALIZED/.test(err.message), err.message.slice(0, 120));
    }

    // ── 8. UPDATE run2 cancelled → X → PAYROLL_RUN_CANCELLED
    console.log('\n8) UPDATE run #2 cancelled → X → PAYROLL_RUN_CANCELLED');
    try {
      await app.query(`UPDATE payroll_runs SET total_gross = 0 WHERE id=$1`, [run2.id]);
      ok('UPDATE cancelled → X est REFUSÉ', false, 'a renvoyé 0 ligne');
    } catch (err) {
      ok('UPDATE cancelled → X → PAYROLL_RUN_CANCELLED', /PAYROLL_RUN_CANCELLED/.test(err.message), err.message.slice(0, 120));
    }

    // ── 9. UPDATE entry2 sur run2 cancelled → PAYROLL_ENTRY_CANCELLED
    console.log('\n9) UPDATE entry sur run #2 cancelled → PAYROLL_ENTRY_CANCELLED');
    try {
      await app.query(`UPDATE payroll_entries SET status='draft' WHERE id=$1`, [entry2.id]);
      ok('UPDATE entry sur run cancelled est REFUSÉ', false, 'a renvoyé 0 ligne');
    } catch (err) {
      ok('UPDATE entry sur run cancelled → PAYROLL_ENTRY_CANCELLED', /PAYROLL_ENTRY_CANCELLED/.test(err.message), err.message.slice(0, 120));
    }

    // ── 10. Régression : un run DRAFT est mutable (l'app doit pouvoir le
    //        finaliser, modifier ses totaux tant qu'il n'est pas finalisé).
    console.log('\n10) Régression : run DRAFT reste mutable');
    const runDraft = (await app.query(
      `INSERT INTO payroll_runs(organization_id,period_year,period_month,status,total_gross,total_net,generated_by)
       VALUES($1,2026,11,'draft',30000,30000,$2) RETURNING id`,
      [orgId, userId],
    )).rows[0];
    const entryDraft = (await app.query(
      `INSERT INTO payroll_entries(organization_id,run_id,staff_id,user_id,period_year,period_month,gross_amount,deductions_amount,net_amount)
       VALUES($1,$2,$3,$4,2026,11,30000,0,30000) RETURNING id`,
      [orgId, runDraft.id, staffId, userId],
    )).rows[0];
    const draftUpdated = (await app.query(
      `UPDATE payroll_runs SET total_gross=35000 WHERE id=$1 RETURNING total_gross::text AS total_gross`,
      [runDraft.id],
    )).rows[0];
    ok('UPDATE total_gross sur run DRAFT → OK', draftUpdated.total_gross === '35000.00', JSON.stringify(draftUpdated));
    // Mise à jour cohérente avec chk_payroll_net (net = gross - deductions)
    const entryDraftUpd = (await app.query(
      `UPDATE payroll_entries SET gross_amount=35000, net_amount=35000 WHERE id=$1 RETURNING net_amount::text AS net_amount`,
      [entryDraft.id],
    )).rows[0];
    ok('UPDATE net_amount sur entrée DRAFT → OK', entryDraftUpd.net_amount === '35000.00', JSON.stringify(entryDraftUpd));

    await app.end();
  } finally {
    // Nettoyage (en superuser, ordre FK + disable trigger payroll pour DELETE)
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    try {
      // Les triggers payroll bloquent le DELETE sur finalized/cancelled : on les
      // désactive temporairement pour le nettoyage uniquement.
      await cleanup.query(`ALTER TABLE payroll_runs DISABLE TRIGGER trg_payroll_run_finalized`);
      await cleanup.query(`ALTER TABLE payroll_entries DISABLE TRIGGER trg_payroll_entry_finalized`);
      if (typeof orgId !== 'undefined') {
        await cleanup.query(`DELETE FROM payroll_lines WHERE organization_id=$1`, [orgId]);
        await cleanup.query(`DELETE FROM payroll_entries WHERE organization_id=$1`, [orgId]);
        await cleanup.query(`DELETE FROM payroll_runs WHERE organization_id=$1`, [orgId]);
        await cleanup.query(`DELETE FROM staff_profiles WHERE organization_id=$1`, [orgId]);
        await cleanup.query(`DELETE FROM rooms WHERE organization_id=$1`, [orgId]);
        await cleanup.query(`DELETE FROM sites WHERE organization_id=$1`, [orgId]);
      }
      await cleanup.query(`DELETE FROM users WHERE email LIKE $1`, [`u-${rng}@x.dz`]);
      await cleanup.query(`DELETE FROM organizations WHERE slug=$1`, [org]);
      await cleanup.query(`ALTER TABLE payroll_runs ENABLE TRIGGER trg_payroll_run_finalized`);
      await cleanup.query(`ALTER TABLE payroll_entries ENABLE TRIGGER trg_payroll_entry_finalized`);
    } catch (e) {
      console.error('Nettoyage phase62 partiel :', e.message);
    }
    await cleanup.end();
    // Le client d'amorçage (ensureAppRole) restait ouvert : un socket actif
    // empêche Node de sortir, donc la suite se terminait sans jamais rendre
    // la main — le job CI restait bloqué jusqu'au plafond. Les autres suites
    // .pg (cf. phase63) ferment bien ce client ; celle-ci l'avait oublié.
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 62 payroll-finalized-lock : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 62 payroll-finalized-lock validée (R15) sur PostgreSQL réel.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
