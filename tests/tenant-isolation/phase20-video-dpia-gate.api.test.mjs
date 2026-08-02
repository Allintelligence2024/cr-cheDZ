#!/usr/bin/env node
/**
 * Phase 20 (roadmap v2) — Vidéosurveillance : blocage DPIA (loi 25-11) AVANT
 * tout module, avec deux tenants A/B + super_admin, sur PostgreSQL réel avec
 * le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. le registre expose le modèle « Vidéosurveillance des locaux »
 *      (is_active=false, requires_dpia=true) et les traitements sensibles
 *      existants sont marqués requires_dpia ;
 *   2. activation GLOBALE de video_surveillance → 422
 *      VIDEO_SURVEILLANCE_GLOBAL_FORBIDDEN (bilingue) ;
 *   3. activation pour A sans DPIA → 422 DPIA_REQUIRED ;
 *   4. DPIA créée mais NON approuvée (draft) → 422 DPIA_REQUIRED toujours ;
 *   5. DPIA approuvée par la directrice → activation pour A : 200 ;
 *   6. B sans DPIA approuvée → toujours 422 (la dérogation est par org) ;
 *   7. isolation : la DPIA de A n'apparaît pas dans la liste de B ;
 *   8. la DÉSACTIVATION reste possible sans DPIA (B : false → 200), et un
 *      autre flag (staff_planning) n'est pas bloqué par ce garde-fou.
 *
 * NB : AUCUN module de vidéosurveillance n'existe — ce test garantit
 * uniquement le verrou de conformité (cf. docs/regulatory/
 * DPIA-VIDEOSURVEILLANCE.md).
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

const VIDEO_PROCESSING = 'Vidéosurveillance des locaux';

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

  const tag = `vsg-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const superAdmin = (await db.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'S','A',$2,'active',true) RETURNING id`,
      [`${tag}-super@test.dz`, hash],
    )).rows[0].id;
    void superAdmin;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'V','31') RETURNING id`, [slug])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenSuper = (await api('POST', '/auth/login', null, { email: `${tag}-super@test.dz`, password })).body.access_token;
    ok('JWT émis (directeurs A/B + super_admin)', Boolean(tokenDirA && tokenDirB && tokenSuper));

    // ── 1. Modèle de registre vidéosurveillance + marqueurs sensibles ────────
    console.log('\n1) Registre : modèle « Vidéosurveillance des locaux »');
    const registry = await api('GET', '/privacy/registry', tokenDirA);
    const video = registry.body.find?.((r) => r.processing_name === VIDEO_PROCESSING);
    ok('Modèle vidéosurveillance présent (global)', Boolean(video), `${registry.body?.length ?? 0} traitements`);
    ok('Modèle inactif + requires_dpia=true (avant DPIA)', video?.is_active === false && video?.requires_dpia === true, JSON.stringify(video));
    const sensitive = ['Photos des enfants', "Dossier de santé de l'enfant", 'Paie du personnel'];
    ok('Traitements sensibles marqués requires_dpia', sensitive.every((n) => registry.body.find?.((r) => r.processing_name === n)?.requires_dpia === true));

    // ── 2. Activation globale interdite ──────────────────────────────────────
    console.log('\n2) Activation globale interdite');
    const globalEnable = await api('POST', '/support/flags/video_surveillance', tokenSuper, { is_enabled: true });
    ok('Global → 422 VIDEO_SURVEILLANCE_GLOBAL_FORBIDDEN', globalEnable.status === 422 && globalEnable.body.code === 'VIDEO_SURVEILLANCE_GLOBAL_FORBIDDEN', JSON.stringify(globalEnable.body).slice(0, 140));
    ok('Message bilingue FR + AR', Boolean(globalEnable.body.message_fr && globalEnable.body.message_ar));
    const globalRow = (await db.query(`SELECT COUNT(*)::int AS n FROM feature_flags WHERE flag_key='video_surveillance' AND organization_id IS NULL AND is_enabled=true`)).rows[0];
    ok('Aucune ligne globale activée en base', globalRow.n === 0);

    // ── 3. Activation pour A sans DPIA → 422 ────────────────────────────────
    console.log('\n3) Organisation A sans DPIA');
    const noDpia = await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: A.org, is_enabled: true });
    ok('Sans DPIA : 422 DPIA_REQUIRED', noDpia.status === 422 && noDpia.body.code === 'DPIA_REQUIRED', JSON.stringify(noDpia.body).slice(0, 140));

    // ── 4. DPIA draft ≠ approved → 422 toujours ─────────────────────────────
    console.log('\n4) DPIA créée mais non approuvée');
    const dpia = await api('POST', '/privacy/dpias', tokenDirA, {
      processing_registry_id: video.id,
      risk_assessment: { level: 'high', reference: 'docs/regulatory/DPIA-VIDEOSURVEILLANCE.md' },
      mitigation_measures: ['accès restreint DPO/directeur', 'purge 30 jours', 'journalisation des visionnages'],
    });
    ok('DPIA créée (draft)', dpia.status === 201 && dpia.body.status === 'draft', JSON.stringify(dpia.body).slice(0, 100));
    const draftEnable = await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: A.org, is_enabled: true });
    ok('Draft non approuvé : 422 DPIA_REQUIRED toujours', draftEnable.status === 422 && draftEnable.body.code === 'DPIA_REQUIRED');

    // ── 5. Approbation → activation OK ──────────────────────────────────────
    console.log('\n5) DPIA approuvée');
    const approve = await api('POST', `/privacy/dpias/${dpia.body.id}/approve`, tokenDirA, {});
    ok('DPIA approuvée (review +365 j)', (approve.status === 200 || approve.status === 201) && approve.body.status === 'approved' && Boolean(approve.body.approved_at));
    const enabled = await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: A.org, is_enabled: true });
    ok('Après approbation : activation pour A réussie', enabled.status === 200 || enabled.status === 201, JSON.stringify(enabled.body));
    const flagRow = (await db.query(`SELECT is_enabled FROM feature_flags WHERE flag_key='video_surveillance' AND organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [A.org])).rows[0];
    ok('Flag video_surveillance = true pour A en base', flagRow?.is_enabled === true);

    // ── 6. B sans DPIA → toujours bloquée ───────────────────────────────────
    console.log('\n6) Dérogation strictement par organisation');
    const bEnable = await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: B.org, is_enabled: true });
    ok('B sans DPIA approuvée : 422 DPIA_REQUIRED', bEnable.status === 422 && bEnable.body.code === 'DPIA_REQUIRED');

    // ── 7. Isolation des DPIA ────────────────────────────────────────────────
    console.log('\n7) Isolation tenant des DPIA');
    const dpiasB = await api('GET', '/privacy/dpias', tokenDirB);
    ok('B ne voit aucune DPIA de A', dpiasB.status === 200 && Array.isArray(dpiasB.body) && dpiasB.body.length === 0, JSON.stringify(dpiasB.body).slice(0, 120));
    const approveCross = await api('POST', `/privacy/dpias/${dpia.body.id}/approve`, tokenDirB, {});
    ok('B ne peut pas (ré)approuver la DPIA de A (404)', approveCross.status === 404, `status=${approveCross.status}`);

    // ── 8. Désactivation libre + autres flags inchangés ──────────────────────
    console.log('\n8) Désactivation et autres flags');
    const disableB = await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: B.org, is_enabled: false });
    ok('Désactivation sans DPIA : 200', disableB.status === 200 || disableB.status === 201, `status=${disableB.status}`);
    const otherFlag = await api('POST', '/support/flags/staff_planning', tokenSuper, { is_enabled: true });
    ok('Autre flag (staff_planning) global non bloqué : 200', otherFlag.status === 200 || otherFlag.status === 201, `status=${otherFlag.status}`);
  } finally {
    try {
      await db.query(`DELETE FROM privacy_dpias WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM feature_flags WHERE flag_key='video_surveillance'`);
      await db.query(`DELETE FROM feature_flags WHERE flag_key='staff_planning' AND organization_id IS NULL`);
      await db.query(`INSERT INTO feature_flags (flag_key, is_enabled, description) VALUES ('video_surveillance', false, 'Vidéosurveillance des locaux (DPIA approuvée exigée — loi 25-11)'), ('staff_planning', false, 'Planning et présence personnel')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}%`]);
      await db.query(`DELETE FROM organizations WHERE slug LIKE $1`, [`${tag}%`]);
    } catch (cleanupError) {
      console.error('Nettoyage phase20 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 20 DPIA vidéosurveillance : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 20 verrou DPIA vidéosurveillance validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
