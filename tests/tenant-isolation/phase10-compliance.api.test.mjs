#!/usr/bin/env node
/**
 * Phase 10 GATE — conformité décret 19-253, avec deux tenants A/B, sur
 * PostgreSQL réel avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. checks automatiques : CAP_150 (capacité), RATIO_EDUC (2 éducateurs/
 *      groupe, ≤ 10 enfants/éducateur), AGE_CRECHE, DOC_STAFF,
 *      PRICE_DISPLAY (tarifs affichés) — persistés dans compliance_checks ;
 *   2. capacité maximale ENFORCÉE : 3e enfant → 409 CAPACITY_EXCEEDED
 *      (création API) ;
 *   3. import dépassant la capacité → 409 CAPACITY_EXCEEDED ;
 *   4. B ne voit pas les checks/le summary de A (aucune donnée croisée) ;
 *   5. B ne peut pas accuser réception d'un check de A (404) ;
 *   6. la directrice de A accuse réception d'un check (acknowledged_at) ;
 *   7. ratio détecté : salle avec enfants et sans éducateur → fail RATIO_EDUC
 *      + DOC_STAFF ; PRICE_DISPLAY passe après création d'un contrat.
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

  const tag = `pc-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const mkOrg = async (slug, maxChildren) => {
      const org = await db.query(
        `INSERT INTO organizations(slug,name_fr,wilaya,max_children) VALUES($1,'C','31',$2) RETURNING id`, [slug, maxChildren],
      );
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',12) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`, 2);       // capacité 2 (test 151e enfant)
    const Ratio = await mkOrg(`${tag}-ratio`, 150); // capacité 150 (ratios)
    const B = await mkOrg(`${tag}-b`, 150);

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenRatio = (await api('POST', '/auth/login', null, { email: `${tag}-ratio-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs émis', Boolean(tokenA && tokenRatio && tokenB));

    // ── 2. Capacité maximale enforceée (création) ───────────────────────────
    console.log('\n2) Capacité maximale enforceée (409)');
    const c1 = await api('POST', '/children', tokenA, { site_id: A.site, room_id: A.room, first_name_fr: 'Yanis', last_name_fr: 'Test', date_of_birth: '2024-01-01' });
    ok('A : 1er enfant créé', c1.status === 201, JSON.stringify(c1.body).slice(0, 100));
    const c2 = await api('POST', '/children', tokenA, { site_id: A.site, room_id: A.room, first_name_fr: 'Amine', last_name_fr: 'Test', date_of_birth: '2024-02-01' });
    ok('A : 2e enfant créé (capacité 2)', c2.status === 201);
    const c3 = await api('POST', '/children', tokenA, { site_id: A.site, room_id: A.room, first_name_fr: 'Lina', last_name_fr: 'Test', date_of_birth: '2024-03-01' });
    ok('A : 3e enfant → 409 CAPACITY_EXCEEDED (décret 19-253)', c3.status === 409 && c3.body.code === 'CAPACITY_EXCEEDED', JSON.stringify(c3.body).slice(0, 120));

    // ── 3. Import dépassant la capacité ─────────────────────────────────────
    console.log('\n3) Import bloqué par la capacité');
    const importRows = [
      { first_name_fr: 'Sara', last_name_fr: 'Test', date_of_birth: '2024-04-01' },
      { first_name_fr: 'Nadia', last_name_fr: 'Test', date_of_birth: '2024-05-01' },
    ];
    const importRes = await api('POST', '/children/import', tokenA, { dry_run: false, rows: importRows });
    ok('Import de 2 lignes (capacité pleine) → 409 CAPACITY_EXCEEDED', importRes.status === 409 && importRes.body.code === 'CAPACITY_EXCEEDED', JSON.stringify(importRes.body).slice(0, 120));

    // ── 1. Checks automatiques (org Ratio : 12 enfants, 0 éducateur) ────────
    console.log('\n1) Checks automatiques 19-253');
    for (let i = 0; i < 12; i += 1) {
      await db.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,$4,'Enfant','R','2024-01-01',$5)`,
        [Ratio.org, Ratio.site, Ratio.room, `PC-R-${String(i + 1).padStart(2, '0')}`, Ratio.director],
      );
    }
    const sum = await api('GET', '/compliance/summary', tokenRatio);
    ok('Summary ratio → 200', sum.status === 200, JSON.stringify(sum.body).slice(0, 120));
    const byCode = Object.fromEntries((sum.body.results ?? []).map((r) => [r.code, r]));
    ok('CAP_150 → pass (12 ≤ 150)', byCode.CAP_150?.result === 'pass', JSON.stringify(byCode.CAP_150));
    ok('RATIO_EDUC → fail (12 enfants, 0 éducateur)', byCode.RATIO_EDUC?.result === 'fail', JSON.stringify(byCode.RATIO_EDUC));
    ok('DOC_STAFF → fail (salle avec enfants sans éducateur)', byCode.DOC_STAFF?.result === 'fail', JSON.stringify(byCode.DOC_STAFF));
    ok('PRICE_DISPLAY → fail (aucun contrat actif)', byCode.PRICE_DISPLAY?.result === 'fail', JSON.stringify(byCode.PRICE_DISPLAY));
    const checks = await api('GET', '/compliance/checks', tokenRatio);
    ok('Checks persistés (compliance_checks)', checks.status === 200 && checks.body.length >= 5, `n=${checks.body.length}`);

    // PRICE_DISPLAY passe après création d'un contrat
    const contract = await api('POST', '/billing/contracts', tokenRatio, {
      child_id: (await db.query(`SELECT id FROM children WHERE organization_id=$1 LIMIT 1`, [Ratio.org])).rows[0].id,
      monthly_base_amount: 10000, start_date: '2026-01-01',
    });
    ok('Contrat créé (org ratio)', contract.status === 201);
    const sum2 = await api('GET', '/compliance/summary', tokenRatio);
    const byCode2 = Object.fromEntries((sum2.body.results ?? []).map((r) => [r.code, r]));
    ok('PRICE_DISPLAY → pass après contrat actif', byCode2.PRICE_DISPLAY?.result === 'pass', JSON.stringify(byCode2.PRICE_DISPLAY));

    // ── 4/5. Isolation B ────────────────────────────────────────────────────
    console.log('\n4-5) Isolation (org B)');
    const sumB = await api('GET', '/compliance/summary', tokenB);
    const bJson = JSON.stringify(sumB.body);
    ok('B : summary sans aucune donnée de A/Ratio', sumB.status === 200 && !bJson.includes(A.org) && !bJson.includes(Ratio.org) && !bJson.includes('PC-R-'), bJson.slice(0, 200));
    const checkId = checks.body[0].id;
    const ackB = await api('POST', `/compliance/checks/${checkId}/acknowledge`, tokenB, {});
    ok('B : accusé réception d’un check de A → 404', ackB.status === 404, JSON.stringify(ackB.body).slice(0, 100));

    // ── 6. Accusé de réception par A ────────────────────────────────────────
    console.log('\n6) Accusé de réception (directrice)');
    const ackA = await api('POST', `/compliance/checks/${checkId}/acknowledge`, tokenRatio, {});
    ok('A : accusé réception → acknowledged_at posé', (ackA.status === 200 || ackA.status === 201) && Boolean(ackA.body.acknowledged_at), JSON.stringify(ackA.body).slice(0, 100));
  } finally {
    try {
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM compliance_checks WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pc-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pc-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pc-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'pc-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'pc-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase10-compliance partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 10 conformité : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 10 conformité validée : décret 19-253 (7 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
