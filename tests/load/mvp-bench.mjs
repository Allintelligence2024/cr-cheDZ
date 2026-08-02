#!/usr/bin/env node
/**
 * Benchmark des critères MVP (Phase 12) — mesures RÉELLES sur PostgreSQL
 * réel + API compilée (rôle NOBYPASSRLS). Crée une organisation de bench
 * isolée (slug bench-*) et la supprime en fin de course.
 *
 * Critères (docs/PLAN_IMPLEMENTATION.md §6) :
 *   - pointage d'une section de 12 enfants  < 3 min  (attendu : ~1 s API)
 *   - repas groupé 12 enfants              < 30 s
 *   - génération d'une facture mensuelle   < 5 s
 *   - import de 50 enfants                 < 60 s
 *
 * Usage : DATABASE_URL=… node tests/load/mvp-bench.mjs
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from '../tenant-isolation/helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const measure = (label, seconds, limit, unit = 's') => {
  const okFlag = seconds < limit;
  results.push({ label, seconds: Number(seconds.toFixed(3)), limit, ok: okFlag });
  console.log(`${okFlag ? '✓' : '✗'} ${label} : ${seconds.toFixed(3)} s (limite ${limit} ${unit})`);
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
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
    const t0 = Date.now();
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, ms: Date.now() - t0, body: await r.json().catch(() => ({})) };
  };

  const tag = `bench-${randomUUID().slice(0, 6)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let orgId = null;

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'Bench','31') RETURNING id`, [tag])).rows[0];
    orgId = org.id;
    const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [orgId])).rows[0].id;
    const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',12) RETURNING id`, [orgId, site])).rows[0].id;
    const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${tag}@test.dz`, hash])).rows[0].id;
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, director, directorRole]);
    const login = await api('POST', '/auth/login', null, { email: `${tag}@test.dz`, password });
    const token = login.body.access_token;
    const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

    // 12 enfants de section
    const childIds = [];
    for (let i = 0; i < 12; i += 1) {
      const c = await fetch(`${base}/children`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ site_id: site, room_id: room, first_name_fr: `Enfant${i}`, last_name_fr: 'Bench', date_of_birth: '2024-01-01' }),
      });
      childIds.push((await c.json()).id);
    }

    // 1) Pointage de la section (12 check-ins)
    const t1 = Date.now();
    for (const cid of childIds) {
      const r = await fetch(`${base}/attendance/check-in`, { method: 'POST', headers: h, body: JSON.stringify({ child_id: cid }) });
      if (r.status !== 201) throw new Error(`check-in ${r.status}`);
    }
    measure('Pointage section 12 enfants (API)', (Date.now() - t1) / 1000, 180);

    // 2) Repas groupé 12 enfants
    const t2 = Date.now();
    const group = await fetch(`${base}/journal/group-actions`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        event_type: 'meal', meal_type: 'lunch', occurred_at: new Date().toISOString(),
        children: childIds.map((child_id) => ({ child_id })),
      }),
    });
    if (group.status !== 201) throw new Error(`group-actions ${group.status}: ${await group.text()}`);
    measure('Repas groupé 12 enfants (API)', (Date.now() - t2) / 1000, 30);

    // 3) Génération facture mensuelle
    const contract = (await api('POST', '/billing/contracts', token, { child_id: childIds[0], monthly_base_amount: 12000, start_date: '2026-01-01' })).body;
    const t3 = Date.now();
    const inv = await fetch(`${base}/billing/invoices/generate`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ contract_id: contract.id, period_year: 2026, period_month: 8, due_date: '2026-09-05' }),
    });
    if (inv.status !== 201) throw new Error(`invoice ${inv.status}`);
    measure('Génération facture mensuelle (API)', (Date.now() - t3) / 1000, 5);

    // 4) Import 50 enfants
    const rows = Array.from({ length: 50 }, (_, i) => ({
      first_name_fr: `Import${i}`, last_name_fr: 'Bench', date_of_birth: '2024-02-01',
    }));
    const t4 = Date.now();
    const imp = await fetch(`${base}/children/import`, {
      method: 'POST', headers: h, body: JSON.stringify({ dry_run: false, rows }),
    });
    const impBody = await imp.json();
    if (imp.status !== 201 || impBody.inserted !== 50) throw new Error(`import ${imp.status}: ${JSON.stringify(impBody).slice(0, 120)}`);
    measure('Import 50 enfants (API)', (Date.now() - t4) / 1000, 60);

    const allOk = results.every((r) => r.ok);
    console.log(`\n${allOk ? '✓' : '✗'} Benchmark MVP : ${results.filter((r) => r.ok).length}/${results.length} critères dans les limites.`);
    if (!allOk) process.exitCode = 1;
  } finally {
    try {
      const orgs = `(SELECT id FROM organizations WHERE slug LIKE 'bench-%')`;
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM payments WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM sync_operations WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM sync_cursors WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM media_access_logs WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM media_assets WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM notification_queue WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM notification_inbox WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM privacy_request_exports WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM privacy_violations WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM privacy_dpias WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM privacy_requests WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM compliance_checks WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM children WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM sites WHERE organization_id IN ${orgs}`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench-%')`);
      await db.query(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'bench-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'bench-%'`);
    } catch (e) {
      console.error('Nettoyage bench partiel :', e.message);
    }
    await app.close();
    await db.end();
  }
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
