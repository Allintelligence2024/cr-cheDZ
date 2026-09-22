#!/usr/bin/env node
/**
 * Phase 61 (remédiation 2026-09-21, R5/F2) — contrôle des rôles du module
 * enrollment (migration 070), sur PostgreSQL réel avec le rôle applicatif.
 *
 * Contexte : le module postdate la matrice d'autorisation v14. Avant R5,
 * la classe contrôleur autorisait `director` ET `receptionist` sur TOUTES
 * les routes — y compris offer/decide (décision de capacité, création
 * d'enfant `pre_registered`). R5 resserre : les décisions sont director-only
 * (décorateur de méthode + double contrôle service).
 *
 * Cas couverts :
 *   1. parent        → 403 sur create/list/capacity (classe) ;
 *   2. educator      → 403 sur create/list/offer (hors liste de la classe) ;
 *   3. receptionist  → create 201, list 200, capacity 200 ;
 *                       waitlist/offer/decide → 403 (R5) ;
 *   4. director      → waitlist 201, offer 201, decide(accepted) 201
 *                       + enfant `pre_registered` créé ; decide(declined) 201 ;
 *   5. isolation     : directeur B → offer/decide sur une demande de A → 404 ;
 *                       list ne renvoie jamais la référence de A.
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

  const tag = `enr-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const roles = Object.fromEntries(
      (await db.query(`SELECT slug, id FROM roles WHERE slug IN ('director','receptionist','educator','parent_primary')`)).rows.map((r) => [r.slug, r.id]),
    );
    const mkUser = async (slug) =>
      (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`, [`${slug}@${tag}.test.dz`, hash])).rows[0].id;

    const mkOrg = async (letter) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'R','31') RETURNING id`, [`${tag}-${letter}`])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'Site') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'Salle',10) RETURNING id`, [org, site])).rows[0].id;
      return { org, site, room };
    };
    const A = await mkOrg('a');
    const B = await mkOrg('b');

    const userA = {
      director: await mkUser(`${tag}-a-director`),
      receptionist: await mkUser(`${tag}-a-receptionist`),
      educator: await mkUser(`${tag}-a-educator`),
      parent: await mkUser(`${tag}-a-parent`),
    };
    const userB = { director: await mkUser(`${tag}-b-director`) };
    await db.query(
      `INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at)
       VALUES($1,$2,$3,true,NOW()),($1,$4,$5,true,NOW()),($1,$6,$7,true,NOW()),($1,$8,$9,true,NOW())`,
      [A.org, userA.director, roles.director, userA.receptionist, roles.receptionist, userA.educator, roles.educator, userA.parent, roles.parent_primary],
    );
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [B.org, userB.director, roles.director]);

    const token = async (suffix) => (await api('POST', '/auth/login', null, { email: `${tag}-${suffix}@${tag}.test.dz`, password })).body.access_token;
    const tDirA = await token('a-director');
    const tRecA = await token('a-receptionist');
    const tEduA = await token('a-educator');
    const tParA = await token('a-parent');
    const tDirB = await token('b-director');
    ok('JWT émis (5 comptes)', Boolean(tDirA && tRecA && tEduA && tParA && tDirB));

    const dto = {
      site_id: A.site,
      child_first_name: 'Yanis', child_last_name: 'Test', child_date_of_birth: '2022-05-01',
      guardian_name: 'Amine Test', guardian_phone: '+213550102030', desired_start_date: '2026-10-01',
    };

    // ── 1. Parent → 403 partout (classe director|receptionist) ─────────────
    console.log('\n1) Parent → 403');
    for (const [n, m, p, b] of [
      ['create', 'POST', '/enrollment/requests', dto],
      ['list', 'GET', '/enrollment/requests', undefined],
      ['capacity', 'GET', `/enrollment/capacity/${A.site}`, undefined],
    ]) {
      const r = await api(m, p, tParA, b);
      ok(`Parent : ${n} → 403`, r.status === 403, `status=${r.status}`);
    }

    // ── 2. Educator → 403 (hors liste de la classe) ─────────────────────────
    console.log('\n2) Educateur → 403');
    for (const [n, m, p, b] of [
      ['create', 'POST', '/enrollment/requests', dto],
      ['list', 'GET', '/enrollment/requests', undefined],
      ['offer', 'POST', '/enrollment/requests/nonexistent-uuid-00000000/offer', { room_id: A.room }],
    ]) {
      const r = await api(m, p, tEduA, b);
      ok(`Educateur : ${n} → 403`, r.status === 403, `status=${r.status}`);
    }

    // ── 3. Receptionist : saisie/lecture OK, décisions 403 (R5) ─────────────
    console.log('\n3) Réception : saisie/lecture OK, décisions 403');
    const created = await api('POST', '/enrollment/requests', tRecA, dto);
    ok('Réception : create → 201', created.status === 201, JSON.stringify(created.body).slice(0, 100));
    const reqId = created.body.id;
    const ref = created.body.reference_number;
    const listed = await api('GET', '/enrollment/requests', tRecA);
    ok('Réception : list → 200 (la référence est visible)', listed.status === 200 && Array.isArray(listed.body) && listed.body.some((r) => r.reference_number === ref), `status=${listed.status}`);
    const cap = await api('GET', `/enrollment/capacity/${A.site}`, tRecA);
    ok('Réception : capacity → 200', cap.status === 200 && cap.body.available >= 0, JSON.stringify(cap.body).slice(0, 80));
    for (const [n, p, b] of [
      ['waitlist', `/enrollment/requests/${reqId}/waitlist`, {}],
      ['offer', `/enrollment/requests/${reqId}/offer`, { room_id: A.room }],
      ['decide', `/enrollment/requests/${reqId}/decide`, { decision: 'accepted' }],
    ]) {
      const r = await api('POST', p, tRecA, b);
      ok(`Réception : ${n} → 403 (R5)`, r.status === 403, `status=${r.status}`);
    }
    const still = (await db.query(`SELECT status FROM enrollment_requests WHERE id=$1`, [reqId])).rows[0];
    ok('Réception refusée : la demande est inchangée (pending)', still.status === 'pending', still.status);

    // ── 4. Director : décisions OK ──────────────────────────────────────────
    console.log('\n4) Directrice : décisions OK');
    const wl = await api('POST', `/enrollment/requests/${reqId}/waitlist`, tDirA, {});
    ok('Directrice : waitlist → 201', wl.status === 201 && wl.body.status === 'waitlisted', JSON.stringify(wl.body).slice(0, 80));

    const created2 = await api('POST', '/enrollment/requests', tDirA, { ...dto, child_first_name: 'Sara' });
    const reqId2 = created2.body.id;
    const off = await api('POST', `/enrollment/requests/${reqId2}/offer`, tDirA, { room_id: A.room });
    ok('Directrice : offer → 201 (room valide)', off.status === 201 && off.body.status === 'offered', JSON.stringify(off.body).slice(0, 80));
    const acc = await api('POST', `/enrollment/requests/${reqId2}/decide`, tDirA, { decision: 'accepted' });
    ok('Directrice : decide(accepted) → 201', acc.status === 201 && acc.body.status === 'accepted', JSON.stringify(acc.body).slice(0, 80));
    const child = (await db.query(`SELECT status, reference_number FROM children WHERE id=$1`, [acc.body.child_id])).rows[0];
    ok('Enfant créé en pre_registered', child && child.status === 'pre_registered', JSON.stringify(child));
    const dec = await api('POST', `/enrollment/requests/${reqId}/decide`, tDirA, { decision: 'declined' });
    ok('Directrice : decide(declined) depuis waitlisted → 201', dec.status === 201 && dec.body.status === 'declined', JSON.stringify(dec.body).slice(0, 80));

    // ── 5. Isolation tenant B ────────────────────────────────────────────────
    console.log('\n5) Isolation (org B)');
    const crossOffer = await api('POST', `/enrollment/requests/${reqId2}/offer`, tDirB, { room_id: B.room });
    ok('Directeur B : offer sur une demande de A → 404', crossOffer.status === 404, `status=${crossOffer.status}`);
    const crossDecide = await api('POST', `/enrollment/requests/${reqId2}/decide`, tDirB, { decision: 'accepted' });
    ok('Directeur B : decide sur une demande de A → 404', crossDecide.status === 404, `status=${crossDecide.status}`);
    const crossList = await api('GET', '/enrollment/requests', tDirB);
    ok('Directeur B : list ne renvoie jamais la référence de A', crossList.status === 200 && crossList.body.every((r) => r.reference_number !== ref && r.reference_number !== created2.body.reference_number), JSON.stringify(crossList.body).slice(0, 120));
  } finally {
    try {
      await db.query(`DELETE FROM enrollment_requests WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%@${tag}.test.dz')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%@${tag}.test.dz')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE '${tag}-%@${tag}.test.dz'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE '${tag}-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase61 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 61 enrollment-authz : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 61 enrollment-authz validée (R5) sur PostgreSQL réel.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
