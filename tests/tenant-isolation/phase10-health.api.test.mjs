#!/usr/bin/env node
/**
 * Phase 10 GATE — santé (dossier médical, allergies, vaccinations,
 * médicaments en double saisie), avec deux tenants A/B, sur PostgreSQL réel
 * avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. A crée le dossier santé d'un enfant + allergie + vaccination +
 *      autorisation de médicament + administration ;
 *   2. la lecture du dossier est journalisée (data_access_logs) ;
 *   3. B ne lit pas le dossier santé de l'enfant de A (404) ;
 *   4. B n'écrit pas sur le dossier de A (404) ;
 *   5. administration hors période autorisée → 422 ;
 *   6. administration sur autorisation inactive → 422 ;
 *   7. confirmation par la MÊME personne → 422 MEDICATION_CONFIRM_SAME_USER ;
 *   8. confirmation par une autre personne → 200 (double saisie) ;
 *   9. parent avec can_view_health=true voit les données santé de son enfant ;
 *  10. parent sans can_view_health → 403 PARENT_ACCESS_DENIED ;
 *  11. parent de l'org B ne voit pas la santé des enfants de A (403/404).
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

  const tag = `ph-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const educatorRole = await db.query(`SELECT id FROM roles WHERE slug='educator'`);
    const parentRole = await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`);
    const mkOrg = async (slug) => {
      const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H','31') RETURNING id`, [slug]);
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      const educator = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'E','T',$2,'active') RETURNING id`, [`${slug}-educator@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW()),($1,$4,$5,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id, educator.rows[0].id, educatorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id, educator: educator.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const childA = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'H-A1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [A.org, A.site, A.room, A.director],
    );
    const childB = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'H-B1','Lina','Test','2024-01-01',$4) RETURNING id`,
      [B.org, B.site, B.room, B.director],
    );
    // Parents : A1 avec can_view_health, A2 sans
    const mkParent = async (email, orgId, childId, canViewHealth) => {
      const u = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`, [email, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u.rows[0].id, parentRole.rows[0].id]);
      const g = await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`, [orgId, u.rows[0].id, A.director]);
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health) VALUES($1,$2,$3,true,$4)`, [orgId, childId, g.rows[0].id, canViewHealth]);
      return { u: u.rows[0].id, g: g.rows[0].id };
    };
    const parentOk = await mkParent(`${tag}-p1@test.dz`, A.org, childA.rows[0].id, true);
    await mkParent(`${tag}-p2@test.dz`, A.org, childA.rows[0].id, false);
    await mkParent(`${tag}-pb@test.dz`, B.org, childB.rows[0].id, true);

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenEducA = (await api('POST', '/auth/login', null, { email: `${tag}-a-educator@test.dz`, password })).body.access_token;
    const tokenP1 = (await api('POST', '/auth/login', null, { email: `${tag}-p1@test.dz`, password })).body.access_token;
    const tokenP2 = (await api('POST', '/auth/login', null, { email: `${tag}-p2@test.dz`, password })).body.access_token;
    const tokenPB = (await api('POST', '/auth/login', null, { email: `${tag}-pb@test.dz`, password })).body.access_token;
    ok('JWT émis (directeurs, éducatrice, parents)', Boolean(tokenA && tokenB && tokenEducA && tokenP1 && tokenP2 && tokenPB));

    // ── 1. Dossier santé de A ───────────────────────────────────────────────
    console.log('\n1) Dossier santé (A)');
    const record = await api('PUT', `/health/${childA.rows[0].id}`, tokenA, {
      blood_type: 'O+', family_doctor: 'Dr Benali', chronic_conditions: 'Asthme léger',
    });
    ok('A : dossier médical créé', record.status === 200 || record.status === 201, JSON.stringify(record.body).slice(0, 100));
    const allergy = await api('POST', `/health/${childA.rows[0].id}/allergies`, tokenA, {
      allergen: 'Arachides', allergen_type: 'food', severity: 'severe', reaction: 'Urticaire', emergency_protocol: 'Injecter EpiPen',
    });
    ok('A : allergie créée', allergy.status === 201, JSON.stringify(allergy.body).slice(0, 100));
    const vaccination = await api('POST', `/health/${childA.rows[0].id}/vaccinations`, tokenA, {
      vaccine_name: 'BCG', dose_number: 1, administered_date: '2024-03-01', next_dose_date: '2026-03-01',
    });
    ok('A : vaccination créée', vaccination.status === 201);
    const guardianRow = await db.query(`SELECT id FROM guardians WHERE user_id=$1`, [parentOk.u]);
    const medAuth = await api('POST', `/health/${childA.rows[0].id}/medication-authorizations`, tokenA, {
      guardian_id: guardianRow.rows[0].id, medication_name: 'Ventoline', dosage: '1 bouffée', frequency: 'si besoin',
      start_date: '2026-01-01', end_date: '2026-12-31',
    });
    ok('A : autorisation de médicament (consentement gardien)', medAuth.status === 201, JSON.stringify(medAuth.body).slice(0, 120));
    const authId = medAuth.body.id;

    // ── 2. Lecture journalisée ──────────────────────────────────────────────
    console.log('\n2) Lecture journalisée (data_access_logs)');
    await api('GET', `/health/${childA.rows[0].id}`, tokenEducA);
    const accessLogs = await db.query(
      `SELECT COUNT(*)::int AS n FROM data_access_logs WHERE organization_id=$1 AND data_type='health_record' AND user_id=$2`,
      [A.org, A.educator],
    );
    ok('Lecture du dossier → data_access_logs (loi 25-11)', accessLogs.rows[0].n >= 1, `n=${accessLogs.rows[0].n}`);

    // ── 3/4. Isolation B ────────────────────────────────────────────────────
    console.log('\n3-4) Isolation santé (org B)');
    const readB = await api('GET', `/health/${childA.rows[0].id}`, tokenB);
    ok('B : lecture du dossier de A → 404', readB.status === 404);
    const writeB = await api('POST', `/health/${childA.rows[0].id}/allergies`, tokenB, {
      allergen: 'Latex', allergen_type: 'environment', severity: 'moderate',
    });
    ok('B : écriture sur le dossier de A → 404', writeB.status === 404);
    const medB = await api('POST', `/health/${childA.rows[0].id}/medication-authorizations`, tokenB, {
      guardian_id: guardianRow.rows[0].id, medication_name: 'X', dosage: '1', frequency: '1/jour', start_date: '2026-01-01',
    });
    ok('B : autorisation médicament pour l’enfant de A → 404', medB.status === 404);

    // ── 5/6. Administrations : période + autorisation active ───────────────
    console.log('\n5-6) Administrations de médicaments');
    const outside = await api('POST', `/health/${childA.rows[0].id}/medication-administrations`, tokenA, {
      authorization_id: authId, administered_at: '2025-06-01T08:00:00Z', dose_given: '1 bouffée',
    });
    ok('Administration hors période autorisée → 422 MEDICATION_OUTSIDE_AUTH', outside.status === 422 && outside.body.code === 'MEDICATION_OUTSIDE_AUTH', JSON.stringify(outside.body).slice(0, 100));
    await db.query(`UPDATE medication_authorizations SET is_active=false WHERE id=$1`, [authId]);
    const inactive = await api('POST', `/health/${childA.rows[0].id}/medication-administrations`, tokenA, {
      authorization_id: authId, administered_at: '2026-06-01T08:00:00Z', dose_given: '1 bouffée',
    });
    ok('Autorisation inactive → 422 MEDICATION_AUTH_INACTIVE', inactive.status === 422 && inactive.body.code === 'MEDICATION_AUTH_INACTIVE');
    await db.query(`UPDATE medication_authorizations SET is_active=true WHERE id=$1`, [authId]);
    const admin = await api('POST', `/health/${childA.rows[0].id}/medication-administrations`, tokenA, {
      authorization_id: authId, administered_at: '2026-06-01T08:00:00Z', dose_given: '1 bouffée', observations: 'OK',
    });
    ok('Administration valide → 201', admin.status === 201, JSON.stringify(admin.body).slice(0, 100));
    const adminId = admin.body.id;

    // ── 7/8. Double saisie ──────────────────────────────────────────────────
    console.log('\n7-8) Double saisie (qui donne / qui confirme)');
    const sameUser = await api('POST', `/health/medication-administrations/${adminId}/confirm`, tokenA, {});
    ok('Confirmation par la même personne → 422 MEDICATION_CONFIRM_SAME_USER', sameUser.status === 422 && sameUser.body.code === 'MEDICATION_CONFIRM_SAME_USER', JSON.stringify(sameUser.body).slice(0, 100));
    const confirm = await api('POST', `/health/medication-administrations/${adminId}/confirm`, tokenEducA, {});
    ok('Confirmation par l’éducatrice → 200 (double saisie)', confirm.status === 200 || confirm.status === 201, JSON.stringify(confirm.body).slice(0, 120));
    const doubleConfirm = await api('POST', `/health/medication-administrations/${adminId}/confirm`, tokenEducA, {});
    ok('Double confirmation → 409 MEDICATION_ALREADY_CONFIRMED', doubleConfirm.status === 409 && doubleConfirm.body.code === 'MEDICATION_ALREADY_CONFIRMED');

    // ── 9/10/11. Accès parent ───────────────────────────────────────────────
    console.log('\n9-11) Accès parent (can_view_health)');
    const parentHealth = await api('GET', `/parent/children/${childA.rows[0].id}/health`, tokenP1);
    ok('Parent can_view_health=true : allergies + vaccinations + médicaments', parentHealth.status === 200 && Array.isArray(parentHealth.body.allergies) && parentHealth.body.allergies.length === 1 && Array.isArray(parentHealth.body.vaccinations) && parentHealth.body.vaccinations.length === 1 && parentHealth.body.medication_administrations[0]?.confirmed === true, JSON.stringify(parentHealth.body).slice(0, 200));
    const parentDenied = await api('GET', `/parent/children/${childA.rows[0].id}/health`, tokenP2);
    ok('Parent can_view_health=false → 403 PARENT_ACCESS_DENIED', parentDenied.status === 403 && parentDenied.body.code === 'PARENT_ACCESS_DENIED');
    const parentB = await api('GET', `/parent/children/${childA.rows[0].id}/health`, tokenPB);
    ok('Parent de l’org B → 403/404 sur la santé de l’enfant de A', parentB.status === 403 || parentB.status === 404, `status=${parentB.status}`);
  } finally {
    try {
      await db.query(`DELETE FROM medication_administrations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM medication_authorizations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM vaccinations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM allergies WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM health_records WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ph-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ph-%')`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'ph-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'ph-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'ph-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase10-health partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 10 santé : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 10 santé validée : dossier médical isolé (11 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
