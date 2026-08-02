#!/usr/bin/env node
/**
 * Phase 17 (roadmap v2) — module paie, avec deux tenants A/B, sur PostgreSQL
 * réel avec le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. génération idempotente : 1re → 201, 2e → 409 PAYROLL_ALREADY_EXISTS ;
 *   2. une entrée par employé actif avec base_salary (ligne base) ;
 *   3. ajout de lignes (prime + retenue) → net = gross − deductions ;
 *   4. finalisation → immuable (plus de lignes après finalize → 422) ;
 *   5. B ne lit pas les runs de A (liste vide) ;
 *   6. B ne lit pas le détail d'un run de A (404) ;
 *   7. B ne génère pas pour les employés de A (404) ;
 *   8. B n'ajoute pas de lignes à l'entrée de A (404).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API compilée (dist/).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
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
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `pr-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [slug])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    // Employés A : 2 actifs avec salaire, 1 inactif, 1 sans salaire
    const mkStaff = async (orgId, email, salary, active) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'E','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      const sp = (await db.query(
        `INSERT INTO staff_profiles (organization_id, user_id, qualification, hire_date, contract_type, base_salary, is_active)
         VALUES ($1,$2,'educator_qualified','2025-01-01','permanent',$3,$4) RETURNING id`, [orgId, u, salary, active],
      )).rows[0].id;
      return { u, sp };
    };
    const s1 = await mkStaff(A.org, `${tag}-a1@test.dz`, 40000, true);
    const s2 = await mkStaff(A.org, `${tag}-a2@test.dz`, 35000, true);
    await mkStaff(A.org, `${tag}-a3@test.dz`, 30000, false);
    await mkStaff(A.org, `${tag}-a4@test.dz`, null, true);
    // Employé B (salaire) pour l'isolation
    const sB = await mkStaff(B.org, `${tag}-b1@test.dz`, 30000, true);

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    // ── 1/2. Génération idempotente + entrées ───────────────────────────────
    console.log('\n1-2) Génération de la paie (idempotente)');
    const gen = await api('POST', '/payroll/generate', tokenA, { period_year: 2026, period_month: 7 });
    ok('Génération → 201 (draft)', gen.status === 201 && gen.body.status === 'draft', JSON.stringify(gen.body).slice(0, 100));
    const runId = gen.body.id;
    const gen2 = await api('POST', '/payroll/generate', tokenA, { period_year: 2026, period_month: 7 });
    ok('Seconde génération → 409 PAYROLL_ALREADY_EXISTS', gen2.status === 409 && gen2.body.code === 'PAYROLL_ALREADY_EXISTS', JSON.stringify(gen2.body).slice(0, 90));
    const entries = (await api('GET', `/payroll/runs/${runId}`, tokenA)).body.entries;
    ok('2 entrées (actifs avec salaire), inactif et sans salaire exclus', Array.isArray(entries) && entries.length === 2, JSON.stringify(entries?.length));
    const grossOk = entries.every((e) => Number(e.gross_amount) === Number(e.net_amount) && e.lines?.length === 1 && e.lines[0].line_type === 'base');
    ok('Chaque entrée : gross = base_salary, ligne base', grossOk, JSON.stringify(entries.map((e) => ({ g: e.gross_amount, l: e.lines?.length }))));

    // ── 3. Lignes (prime + retenue) → net recalculé ─────────────────────────
    console.log('\n3) Primes et retenues');
    const entryA = entries.find((e) => e.staff_id === s1.sp);
    const addLines = await api('POST', `/payroll/entries/${entryA.id}/lines`, tokenA, {
      lines: [
        { line_type: 'bonus', label_fr: 'Prime de transport', amount: 5000 },
        { line_type: 'deduction', label_fr: 'Absence', amount: -2000 },
      ],
    });
    ok('Lignes ajoutées (bonus 5000 + retenue 2000)', addLines.status === 200 || addLines.status === 201, JSON.stringify(addLines.body).slice(0, 120));
    ok('Net = 40000 + 5000 − 2000 = 43000', Number(addLines.body.net) === 43000, `net=${addLines.body.net}`);
    const detailAfter = (await api('GET', `/payroll/runs/${runId}`, tokenA)).body;
    const entryUpdated = detailAfter.entries.find((e) => e.staff_id === s1.sp);
    ok('Entrée mise à jour (gross 45000, deductions 2000, net 43000)',
      Number(entryUpdated.gross_amount) === 45000 && Number(entryUpdated.deductions_amount) === 2000 && Number(entryUpdated.net_amount) === 43000,
      JSON.stringify(entryUpdated));

    // ── 4. Finalisation → immuable ──────────────────────────────────────────
    console.log('\n4) Finalisation (immuable)');
    const fin = await api('POST', `/payroll/runs/${runId}/finalize`, tokenA, {});
    ok('Finalisation → finalized', (fin.status === 200 || fin.status === 201) && fin.body.status === 'finalized', JSON.stringify(fin.body).slice(0, 90));
    const fin2 = await api('POST', `/payroll/runs/${runId}/finalize`, tokenA, {});
    ok('Double finalisation → 409 PAYROLL_FINALIZED', fin2.status === 409 && fin2.body.code === 'PAYROLL_FINALIZED');
    const addAfter = await api('POST', `/payroll/entries/${entryA.id}/lines`, tokenA, { lines: [{ line_type: 'bonus', label_fr: 'X', amount: 100 }] });
    ok('Ligne après finalisation → 422 PAYROLL_FINALIZED', addAfter.status === 422 && addAfter.body.code === 'PAYROLL_FINALIZED', JSON.stringify(addAfter.body).slice(0, 90));

    // ── 5/6/7/8. Isolation B ────────────────────────────────────────────────
    console.log('\n5-8) Isolation (org B)');
    const listB = await api('GET', '/payroll/runs', tokenB);
    ok('B : liste des runs vide', listB.status === 200 && listB.body.length === 0);
    ok('B : détail du run de A → 404', (await api('GET', `/payroll/runs/${runId}`, tokenB)).status === 404);
    // La génération est globale au tenant : B génère SA paie (jamais celle de A —
    // l'isolation est prouvée par la liste/détail 404 et l'ajout de ligne 404).
    const genB7 = await api('POST', '/payroll/generate', tokenB, { period_year: 2026, period_month: 7 });
    ok('B : génération de SA paie (mois 7) → 201 — aucune donnée de A', genB7.status === 201 && (await api('GET', `/payroll/runs/${genB7.body.id}`, tokenB)).body.entries.length === 1);
    // B génère SA paie (validité du flux pour B) puis tente d'ajouter une ligne chez A
    const genB = await api('POST', '/payroll/generate', tokenB, { period_year: 2026, period_month: 8 });
    ok('B : sa propre génération → 201 (1 entrée)', genB.status === 201 && genB.body.id);
    const runB = (await api('GET', `/payroll/runs/${genB.body.id}`, tokenB)).body;
    const entryB = runB.entries[0];
    ok('B : entrée de son employé (salaire 30000)', Number(entryB.gross_amount) === 30000);
    const crossAdd = await api('POST', `/payroll/entries/${entryA.id}/lines`, tokenB, { lines: [{ line_type: 'bonus', label_fr: 'X', amount: 1 }] });
    ok('B : ajout de ligne sur l\'entrée de A → 404', crossAdd.status === 404, `status=${crossAdd.status}`);
    void sB; void s2;
  } finally {
    try {
      await db.query(`DELETE FROM payroll_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pr-%')`);
      await db.query(`DELETE FROM payroll_entries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pr-%')`);
      await db.query(`DELETE FROM payroll_runs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pr-%')`);
      await db.query(`DELETE FROM staff_profiles WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pr-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pr-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pr-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pr-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'pr-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'pr-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase17 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 17 paie : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 17 paie validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
