#!/usr/bin/env node
/**
 * Test API — Phase 79 : l'écran Analytics Direction répond sur sa requête
 * PAR DÉFAUT (correctif audit 2026-10-02).
 *
 * Contexte : l'écran `AnalyticsPage` (admin-web) charge cinq endpoints en
 * parallèle, dont `GET /api/v1/analytics/attendance?groupBy=day`. Ce dernier
 * échouait SYSTÉMATIQUEMENT en 500 : `AnalyticsService.attendanceTrend()`
 * passait un tableau de paramètres avec un `null` fantôme en 2e position
 * (`[tenantId, null, trunc, fromDate, toDate]`) alors que le SQL ne référence
 * pas `$2` — PostgreSQL refuse la requête au parse :
 *   « 42P18 could not determine data type of parameter $2 ».
 * Comme `Promise.all` rejette au premier 500, TOUT l'écran Analytics
 * s'affichait en erreur, y compris pour la directrice.
 *
 * Ce que cette suite prouve :
 *  1. la requête par défaut de l'écran (`?groupBy=day`) → 200 avec des points
 *     de période réels — plus jamais 42P18/500 ;
 *  2. sans aucun paramètre (défauts du DTO) → 200 également ;
 *  3. les variantes `week` / `month` et le filtre `site_id` → 200 (les trois
 *     branches de liaison de paramètres sont exercées) ;
 *  4. les cinq autres endpoints de l'écran → 200 (overview, billing, revenue,
 *     occupancy, ratios) ;
 *  5. contrôle d'accès : les rôles non-direction (éducatrice) → 403 ;
 *  6. verrou statique : plus aucun `null` fantôme dans les paramètres de
 *     `attendanceTrend` (la régression ne peut pas revenir silencieusement).
 *
 * Usage : node tests/tenant-isolation/phase79-analytics-director.api.test.mjs
 * (apps/api compilé ; PostgreSQL réel ; DATABASE_URL).
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  const api = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };

  const tag = `p79-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    // ── Fixtures : une organisation, une directrice, une éducatrice, 3 enfants
    //    présents aujourd'hui dans deux salles ────────────────────────────────
    const roles = Object.fromEntries(
      (await admin.query(`SELECT slug, id FROM roles WHERE slug IN ('director','educator')`)).rows.map((r) => [r.slug, r.id]),
    );
    const org = (await admin.query(
      `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P79 Analytics','31') RETURNING id`,
      [`${tag}-org`],
    )).rows[0].id;
    const site = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S1') RETURNING id`, [org])).rows[0].id;
    const roomA = (await admin.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Salle A',12) RETURNING id`, [org, site])).rows[0].id;
    const roomB = (await admin.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Salle B',12) RETURNING id`, [org, site])).rows[0].id;

    const mkUser = async (suffix, roleId, roomIds = null) => {
      const email = `${tag}-${suffix}@test.dz`;
      const user = (await admin.query(
        `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'T','T',$2,'active') RETURNING id`,
        [email, hash],
      )).rows[0].id;
      await admin.query(
        `INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at,room_ids)
         VALUES($1,$2,$3,true,NOW(),$4::uuid[])`,
        [org, user, roleId, roomIds],
      );
      return { email, user };
    };
    const director = await mkUser('dir', roles.director);
    const educator = await mkUser('edu', roles.educator, [roomA]);

    const children = [];
    for (const [index, roomId] of [[1, roomA], [2, roomA], [3, roomB]]) {
      children.push((await admin.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,$4,'Enfant','P79',$5::date,$6) RETURNING id`,
        [org, site, roomId, `${tag}-${index}`, `2024-01-0${index}`, director.user],
      )).rows[0].id);
    }
    for (const [index, child] of children.entries()) {
      await admin.query(
        `INSERT INTO attendance_sessions(organization_id,site_id,room_id,child_id,session_date,status)
         VALUES($1,$2,$3,$4,(NOW() AT TIME ZONE 'Africa/Algiers')::date,$5)`,
        [org, site, index < 2 ? roomA : roomB, child, index === 0 ? 'present' : index === 1 ? 'departed' : 'absent'],
      );
    }

    // Encaissement du jour (payment_allocations.amount_allocated) : prouve que
    // `revenueTrend` lit la bonne colonne ET n'exclut plus le dernier jour.
    const invoice = (await admin.query(
      `INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,paid_amount,status,due_date,created_by)
       VALUES($1,$2,$3,2026,10,5000,5000,0,'sent',CURRENT_DATE,$4) RETURNING id`,
      [org, `${tag}-INV`, children[0], director.user],
    )).rows[0].id;
    const payment = (await admin.query(
      `INSERT INTO payments(organization_id,site_id,reference_number,child_id,amount,method,status,created_by)
       VALUES($1,$2,$3,$4,5000,'cash','confirmed',$5) RETURNING id`,
      [org, site, `${tag}-PAY`, children[0], director.user],
    )).rows[0].id;
    await admin.query(
      `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
       VALUES($1,$2,$3,5000,$4)`,
      [org, payment, invoice, director.user],
    );

    // Franchissement de ratio temps réel (salle dans `details->>'room_id'`) :
    // prouve que `ratiosHistory` lit le bon emplacement (compliance_checks n'a
    // ni colonne `room_id` ni colonne `check_type`).
    const ratioRule = (await admin.query(
      `SELECT id FROM compliance_rules WHERE code='RATIO_EDUC' AND is_active LIMIT 1`,
    )).rows[0];
    await admin.query(
      `INSERT INTO compliance_checks(organization_id,rule_id,result,details,checked_by)
       VALUES($1,$2,'fail',$3,'realtime')`,
      [org, ratioRule.id, JSON.stringify({ room_id: roomA, room: 'Salle A', source: 'check_in' })],
    );

    const connect = async (email) => {
      const res = await api('POST', '/auth/login', null, { email, password });
      if (res.status !== 200 && res.status !== 201) throw new Error(`login ${email} → ${res.status}`);
      return res.body.access_token;
    };
    const tokenDirector = await connect(director.email);
    const tokenEducator = await connect(educator.email);

    // ── 1. LA requête par défaut de l'écran (celle qui échouait en 42P18) ────
    console.log('\n1) Requête par défaut de l’écran : GET /analytics/attendance?groupBy=day');
    const attendance = await api('GET', '/analytics/attendance?groupBy=day', tokenDirector);
    ok('GET /analytics/attendance?groupBy=day → 200 (plus jamais 500 « 42P18 parameter $2 »)',
      attendance.status === 200, `status=${attendance.status} ${JSON.stringify(attendance.body)?.slice(0, 160)}`);
    ok('Réponse avec fenêtre from/to et tableau `data`',
      typeof attendance.body?.from === 'string' && typeof attendance.body?.to === 'string' && Array.isArray(attendance.body?.data),
      JSON.stringify(attendance.body)?.slice(0, 160));
    ok('Les présences du jour sont bien agrégées (SQL réellement exécuté sur les données)',
      Array.isArray(attendance.body?.data) && attendance.body.data.some((p) => Number(p.present) >= 1 && Number(p.absent) >= 1),
      JSON.stringify(attendance.body?.data)?.slice(0, 200));

    console.log('\n2) Sans aucun paramètre : les défauts du DTO s’appliquent');
    const attendanceDefaults = await api('GET', '/analytics/attendance', tokenDirector);
    ok('GET /analytics/attendance → 200 (groupBy=day par défaut)',
      attendanceDefaults.status === 200 && attendanceDefaults.body?.groupBy === 'day',
      `status=${attendanceDefaults.status} groupBy=${attendanceDefaults.body?.groupBy}`);

    console.log('\n3) Variantes de troncature et filtre site_id (les 3 branches de liaison)');
    for (const groupBy of ['week', 'month']) {
      const res = await api('GET', `/analytics/attendance?groupBy=${groupBy}`, tokenDirector);
      ok(`groupBy=${groupBy} → 200`, res.status === 200 && Array.isArray(res.body?.data), `status=${res.status}`);
    }
    const bySite = await api('GET', `/analytics/attendance?groupBy=day&site_id=${site}`, tokenDirector);
    ok('site_id (paramètre $5 optionnel) → 200 et filtre appliqué',
      bySite.status === 200 && Array.isArray(bySite.body?.data) && bySite.body.data.length >= 1,
      `status=${bySite.status} ${JSON.stringify(bySite.body)?.slice(0, 160)}`);

    // ── 4. Les cinq autres endpoints chargés par l'écran ─────────────────────
    console.log('\n4) Les autres endpoints de l’écran Analytics');
    const overview = await api('GET', '/analytics/overview', tokenDirector);
    ok('GET /analytics/overview → 200 (KPI présents du jour)',
      overview.status === 200 && Number(overview.body?.kpis?.attendance_today?.total) >= 3,
      `status=${overview.status} ${JSON.stringify(overview.body?.kpis?.attendance_today)}`);
    for (const path of ['/analytics/billing', '/analytics/revenue', '/analytics/occupancy', '/analytics/ratios']) {
      const res = await api('GET', path, tokenDirector);
      ok(`GET ${path} → 200`, res.status === 200, `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    }

    const revenue = await api('GET', '/analytics/revenue', tokenDirector);
    const todayPeriod = (revenue.body?.data ?? []).at(-1);
    ok('Revenus : l’encaissement du jour est bien compté (colonne amount_allocated + borne haute inclusive)',
      Number(todayPeriod?.revenue) >= 5000,
      JSON.stringify(revenue.body?.data)?.slice(0, 200));

    const ratios = await api('GET', '/analytics/ratios', tokenDirector);
    ok('Ratios : le franchissement temps réel est retourné avec sa salle',
      ratios.status === 200 && Array.isArray(ratios.body?.breaches)
      && ratios.body.breaches.some((b) => b.room_id === String(roomA) && b.result === 'fail'),
      JSON.stringify(ratios.body?.breaches)?.slice(0, 200));

    // ── 5. Contrôle d'accès : écran réservé direction / comptable ────────────
    console.log('\n5) Accès : une éducatrice ne lit pas l’analytics financière');
    const forbidden = await api('GET', '/analytics/overview', tokenEducator);
    ok('Éducatrice → 403 (DIRECTOR_ROLES)', forbidden.status === 403, `status=${forbidden.status}`);
    for (const path of ['/analytics/attendance']) {
      const res = await api('GET', path, tokenEducator);
      ok(`Éducatrice sur ${path} → 403`, res.status === 403, `status=${res.status}`);
    }

    // ── 6. Verrou statique : plus de paramètre fantôme ───────────────────────
    console.log('\n6) Verrou statique anti-régression');
    const source = readFileSync(join(REPO, 'apps/api/src/modules/analytics/analytics.service.ts'), 'utf8');
    ok('Aucun `null` fantôme dans les paramètres liés (motif `[tenantId, null, trunc`)',
      !/\[\s*tenantId\s*,\s*null\s*,\s*trunc/.test(source), 'motif interdit présent');
    ok('La troncature est liée sans trou ($2) et les bornes en $3/$4',
      source.includes('date_trunc($2, session_date)') && source.includes('BETWEEN $3::date AND $4::date'));
  } finally {
    await app.close();
    await admin.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 79 analytics : ${failures.length} — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 79 analytics validée (requête par défaut + accès) sur PostgreSQL réel.');
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
