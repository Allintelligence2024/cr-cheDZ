#!/usr/bin/env node
/**
 * Test API — Phase 80 : entrée invalide → 400 (jamais 500).
 *
 * Constat (analyse 2026-10-02) : des identifiants et des dates fournis par le
 * client atteignaient PostgreSQL sans validation. Un UUID malformé
 * (`/children/abc`) ou une date au calendrier inexistant (`2026-02-31`,
 * acceptée par `@IsDateString` — isISO8601 non strict) finissaient en erreur de
 * cast (`22P02` / `22008`) : **500 INTERNAL_ERROR** au lieu d'un 400, avec
 * bruit d'alerte et réessais inutiles côté client.
 *
 * Correctifs gardés par cette suite :
 *  1. paramètres d'URL UUID → `ParseUUIDPipe` (children, devices, journal,
 *     parents, staff, users) ;
 *  2. filtres de requête UUID optionnels (billing `child_id`/`site_id`,
 *     attestations `child_id`) → `ParseUUIDPipe({ optional: true })` ;
 *  3. dates strictes `IsStrictIsoDate` (calendrier vérifié) dans tous les DTO
 *     et dans `onlineReconciliation` (`from`/`to`) — y compris les
 *     horodatages (`2026-02-31T10:00:00Z`) ;
 *  4. corps `{role_id}` de l'ajout de rôle → DTO validé (`@IsUUID`) ;
 *  5. verrous statiques : plus aucun `@Param('<uuid>')` sans pipe, plus aucun
 *     `@Query('child_id'|'site_id')` sans validation.
 *  6. autorisation : `GET /feature-flags` (configuration du tenant) est
 *     réservé à la direction (`@Roles`) — il était ouvert à tout compte
 *     authentifié.
 *
 * Usage : node tests/tenant-isolation/phase80-input-validation.api.test.mjs
 * (apps/api compilé ; PostgreSQL réel ; DATABASE_URL).
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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

  const tag = `p80-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    // ── Fixtures minimales : une organisation, une salle, un enfant, une
    //    directrice (les rejets 400 sont décidés AVANT toute lecture en base,
    //    mais le contrôle positif appelle de vraies ressources).
    const directorRole = (await admin.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const org = (await admin.query(
      `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P80 Validation','31') RETURNING id`,
      [`${tag}-org`],
    )).rows[0].id;
    const site = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S1') RETURNING id`, [org])).rows[0].id;
    const room = (await admin.query(
      `INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Salle A',12) RETURNING id`,
      [org, site],
    )).rows[0].id;
    const director = (await admin.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'T','T',$2,'active') RETURNING id`,
      [`${tag}-dir@test.dz`, hash],
    )).rows[0].id;
    const educatorRole = (await admin.query(`SELECT id FROM roles WHERE slug='educator'`)).rows[0].id;
    const educator = (await admin.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'E','E',$2,'active') RETURNING id`,
      [`${tag}-edu@test.dz`, hash],
    )).rows[0].id;
    await admin.query(
      `INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW()),($1,$4,$5,true,NOW())`,
      [org, director, directorRole, educator, educatorRole],
    );
    const child = (await admin.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,$4,'Enfant','P80','2024-01-01'::date,$5) RETURNING id`,
      [org, site, room, `${tag}-1`, director],
    )).rows[0].id;

    const login = await api('POST', '/auth/login', null, { email: `${tag}-dir@test.dz`, password });
    if (login.status !== 200 && login.status !== 201) throw new Error(`login → ${login.status}`);
    const token = login.body.access_token;
    const eduLogin = await api('POST', '/auth/login', null, { email: `${tag}-edu@test.dz`, password });
    if (eduLogin.status !== 200 && eduLogin.status !== 201) throw new Error(`login educator → ${eduLogin.status}`);
    const eduToken = eduLogin.body.access_token;
    const anyUuid = randomUUID();

    // ── 1. Paramètres d'URL UUID malformés → 400 ─────────────────────────────
    console.log('\n1) Paramètres d’URL UUID invalides : 400, jamais 500');
    const pathCases = [
      ['GET', '/children/not-a-uuid'],
      ['GET', '/devices'], // contrôle : route sans paramètre (200 attendu plus bas)
      ['POST', '/devices/not-a-uuid/revoke'],
      ['PATCH', '/journal/events/not-a-uuid/visibility', { visible_to_parents: true }],
      ['GET', '/parent/children/not-a-uuid/feed'],
      ['DELETE', `/children/${anyUuid}/guardians/not-a-uuid`],
      ['DELETE', `/children/${anyUuid}/emergency-contacts/not-a-uuid`],
      ['PATCH', `/children/${anyUuid}/pickups/not-a-uuid`, {}],
      ['POST', `/staff/${anyUuid}/assignments/not-a-uuid/end`],
      // NB : `UsersController` est monté à la racine (`@Controller()`),
      // les routes sont donc `/members/:userId/roles` (pas `/users/...`).
      ['GET', '/members/not-a-uuid/roles'],
      ['POST', `/members/not-a-uuid/roles`, { role_id: anyUuid }],
      ['POST', `/members/${anyUuid}/roles`, { role_id: 'not-a-uuid' }],
    ];
    for (const [method, path, body] of pathCases) {
      if (path === '/devices') continue; // sentinelle de lisibilité, testée au §4
      const res = await api(method, path, token, body);
      ok(`${method} ${path} → 400 (UUID invalide)`, res.status === 400, `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    }

    // ── 2. Filtres de requête UUID malformés → 400 ───────────────────────────
    console.log('\n2) Filtres de requête UUID invalides : 400');
    for (const path of [
      '/billing/invoices?child_id=not-a-uuid',
      '/billing/contracts?child_id=not-a-uuid',
      '/billing/payments?child_id=not-a-uuid',
      '/billing/cash-registers?site_id=not-a-uuid',
      '/attestations?child_id=not-a-uuid',
      '/analytics/attendance?site_id=not-a-uuid',
    ]) {
      const res = await api('GET', path, token);
      ok(`GET ${path} → 400 (UUID invalide)`, res.status === 400, `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    }

    // ── 3. Dates au calendrier inexistant → 400 (et non 500 sur le cast) ─────
    console.log('\n3) Dates impossibles (2026-02-31) : 400, jamais 500');
    const dateCases = [
      ['GET', '/analytics/attendance?from=2026-02-31'],
      ['GET', '/analytics/billing?from=2026-02-31'],
      ['GET', '/analytics/revenue?to=2026-02-31'],
      ['GET', '/analytics/ratios?date=2026-02-31'],
      ['GET', '/analytics/ratios?date=pas-une-date'],
      ['GET', '/billing/payments/online/reconciliation?from=2026-02-31'],
      ['GET', '/attendance/summary?date=2026-02-31'],
      ['GET', '/staff/schedule?from=2026-02-31&to=2026-02-28'],
    ];
    for (const [method, path] of dateCases) {
      const res = await api(method, path, token);
      ok(`${method} ${path} → 400 (date invalide)`, res.status === 400, `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    }
    const stamp = await api('POST', '/attendance/check-in', token, { child_id: child, occurred_at: '2026-02-31T10:00:00Z' });
    ok('POST /attendance/check-in (horodatage 2026-02-31T10:00:00Z) → 400', stamp.status === 400, `status=${stamp.status}`);

    // ── 4. Contrôles positifs : les valeurs valides passent toujours ─────────
    console.log('\n4) Contrôles positifs : les entrées valides ne sont pas cassées');
    const goodChild = await api('GET', `/children/${child}`, token);
    ok('GET /children/:id (UUID valide) → 200', goodChild.status === 200, `status=${goodChild.status}`);
    const goodInvoices = await api('GET', `/billing/invoices?child_id=${child}`, token);
    ok('GET /billing/invoices?child_id=<uuid> → 200', goodInvoices.status === 200, `status=${goodInvoices.status}`);
    const goodRatios = await api('GET', '/analytics/ratios?date=2026-02-28', token);
    ok('GET /analytics/ratios?date=2026-02-28 (date valide) → 200', goodRatios.status === 200, `status=${goodRatios.status}`);
    const goodAttendance = await api('GET', '/analytics/attendance?from=2026-01-01&to=2026-02-28', token);
    ok('GET /analytics/attendance?from=&to= valides → 200', goodAttendance.status === 200, `status=${goodAttendance.status}`);
    const devices = await api('GET', '/devices', token);
    ok('GET /devices (sans paramètre) → 200', devices.status === 200, `status=${devices.status}`);

    // ── 5. Verrous statiques : la régression ne peut pas revenir ────────────
    console.log('\n5) Verrous statiques (sources)');
    const modulesDir = join(REPO, 'apps/api/src/modules');
    const controllers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.controller.ts')) controllers.push(full);
      }
    };
    walk(modulesDir);
    const uuidParamNames = ['id', 'gid', 'cid', 'pid', 'aid', 'userId', 'childId', 'mediaId'];
    const rawParamOffenders = [];
    const rawQueryOffenders = [];
    for (const file of controllers) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const param = /@Param\('([^']+)'\)/.exec(line);
        if (param && uuidParamNames.includes(param[1]) && !line.includes('ParseUUIDPipe')) {
          rawParamOffenders.push(`${file.split('/modules/')[1]}: ${line.trim()}`);
        }
        const query = /@Query\('(child_id|site_id)'\)/.exec(line);
        if (query && !line.includes('ParseUUIDPipe')) rawQueryOffenders.push(`${file.split('/modules/')[1]}: ${line.trim()}`);
      }
    }
    ok('Aucun @Param(<uuid>) sans ParseUUIDPipe', rawParamOffenders.length === 0, rawParamOffenders.join(' | '));
    ok('Aucun @Query(child_id|site_id) sans ParseUUIDPipe', rawQueryOffenders.length === 0, rawQueryOffenders.join(' | '));
    const dtoSources = ['analytics/dto/analytics', 'attendance/dto/attendance', 'billing/dto/billing', 'children/dto/children', 'staff/dto/staff']
      .map((p) => join(REPO, `apps/api/src/modules/${p}.dto.ts`))
      .filter((p) => { try { readFileSync(p); return true; } catch { return false; } });
    const laxDates = dtoSources.filter((p) => readFileSync(p, 'utf8').includes('@IsDateString('));
    ok('Plus aucun @IsDateString( lax dans les DTO sensibles (IsStrictIsoDate)', laxDates.length === 0, laxDates.join(' | '));

    // ── 6. Autorisation : configuration du tenant réservée à la direction ───
    console.log('\n6) Autorisation : la liste des feature flags n’est pas ouverte à tous');
    const flagsEdu = await api('GET', '/feature-flags', eduToken);
    ok('GET /feature-flags (éducatrice) → 403', flagsEdu.status === 403, `status=${flagsEdu.status}`);
    const flagsDir = await api('GET', '/feature-flags', token);
    ok('GET /feature-flags (directrice) → 200', flagsDir.status === 200, `status=${flagsDir.status}`);
    ok('GET /feature-flags (directrice) → items[]', Array.isArray(flagsDir.body?.items), JSON.stringify(flagsDir.body)?.slice(0, 120));
  } finally {
    await app.close();
    await admin.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 80 validation des entrées : ${failures.length} — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 80 validée : entrée invalide → 400 (UUID, dates, corps), valeurs valides préservées.');
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
