#!/usr/bin/env node
/**
 * Phase 21 (roadmap v2) — Module vidéosurveillance (post-DPIA, loi 25-11),
 * avec deux tenants A/B + super_admin, sur PostgreSQL réel NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. flag off → 422 VIDEO_FEATURE_DISABLED (bilingue) ;
 *   2. DPIA approuvée + flag activé (support) → caméra créée ; zone invalide
 *      → 400 ; doublon de nom → 409 CAMERA_NAME_TAKEN ; listage avec compteur ;
 *   3. B (flag off) → 422 ; après DPIA approuvée + flag, B voit une liste
 *      VIDE (pas les caméras de A) ; PATCH croisée → 404 ;
 *   4. clips : presign S3 (signature locale) puis enregistrement (backend
 *      local explicite — fichier RÉEL écrit dans STORAGE_LOCAL_DIR) ;
 *   5. download → content_url local ; GET content = octets identiques ;
 *      chaque visionnage journalisé (audit_logs action 'view') ;
 *   6. isolation : B ne télécharge pas le clip de A (404), liste vide,
 *      aucune fuite d'audit ;
 *   7. purge DPIA 30 j : clip local backdaté → worker (job video_clips_purge)
 *      supprime le FICHIER réel ET la ligne ; clip récent conservé ;
 *   8. honnêteté : clip S3 backdaté sans S3 joignable → job ÉCHOUÉ (jamais
 *      de fausse purge) et la ligne reste.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/).
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = '/tmp/pgtest/videostore';
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

  const tag = `vsm-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const storeDir = '/tmp/pgtest/videostore';
  let worker = null;
  let orgA = null; let orgB = null;

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    await db.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'S','A',$2,'active',true)`,
      [`${tag}-super@test.dz`, hash],
    );
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'V','31') RETURNING id`, [slug])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D',$2,$3,'active') RETURNING id`, [`${slug}-director@test.dz`, 'T', hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    orgA = A.org; orgB = B.org;
    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenSuper = (await api('POST', '/auth/login', null, { email: `${tag}-super@test.dz`, password })).body.access_token;
    ok('JWT émis (directeurs A/B + super_admin)', Boolean(tokenDirA && tokenDirB && tokenSuper));

    const enableVideoFor = async (orgId, tokenDir) => {
      const registry = (await api('GET', '/privacy/registry', tokenDir)).body;
      const video = registry.find((r) => r.processing_name === 'Vidéosurveillance des locaux');
      const dpia = await api('POST', '/privacy/dpias', tokenDir, {
        processing_registry_id: video.id,
        risk_assessment: { level: 'moderate', reference: 'docs/regulatory/DPIA-VIDEOSURVEILLANCE.md' },
        mitigation_measures: ['accès restreint', 'purge 30 j', 'visionnage journalisé'],
      });
      await api('POST', `/privacy/dpias/${dpia.body.id}/approve`, tokenDir, {});
      await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: orgId, is_enabled: true });
    };

    // ── 1. Flag off → 422 ───────────────────────────────────────────────────
    console.log('\n1) Module verrouillé sans flag');
    const disabled = await api('POST', '/video/cameras', tokenDirA, { name: 'Entrée', zone: 'entrance' });
    ok('Sans flag : 422 VIDEO_FEATURE_DISABLED', disabled.status === 422 && disabled.body.code === 'VIDEO_FEATURE_DISABLED', JSON.stringify(disabled.body).slice(0, 140));
    ok('Message bilingue FR + AR', Boolean(disabled.body.message_fr && disabled.body.message_ar));

    // ── 2. Activation conforme (DPIA) + caméras ─────────────────────────────
    console.log('\n2) DPIA approuvée → flag → caméras');
    await enableVideoFor(A.org, tokenDirA);
    const zone400 = await api('POST', '/video/cameras', tokenDirA, { name: 'Sanitaires', zone: 'bathroom' });
    ok('Zone invalide → 400 (DTO)', zone400.status === 400, `status=${zone400.status}`);
    const cam = await api('POST', '/video/cameras', tokenDirA, { name: 'Entrée principale', zone: 'entrance' });
    ok('Caméra créée (zone autorisée)', (cam.status === 201 || cam.status === 200) && cam.body.zone === 'entrance', JSON.stringify(cam.body).slice(0, 120));
    const dup = await api('POST', '/video/cameras', tokenDirA, { name: 'Entrée principale', zone: 'corridor' });
    ok('Doublon de nom → 409 CAMERA_NAME_TAKEN', dup.status === 409 && dup.body.code === 'CAMERA_NAME_TAKEN', JSON.stringify(dup.body).slice(0, 120));
    const camsA = await api('GET', '/video/cameras', tokenDirA);
    ok('Liste A : 1 caméra, clips_count=0', camsA.status === 200 && camsA.body.length === 1 && camsA.body[0].clips_count === 0);

    // ── 3. B : verrou puis isolation ────────────────────────────────────────
    console.log('\n3) Tenant B : verrou puis isolation');
    const bDisabled = await api('GET', '/video/cameras', tokenDirB);
    ok('B sans flag : 422 VIDEO_FEATURE_DISABLED', bDisabled.status === 422 && bDisabled.body.code === 'VIDEO_FEATURE_DISABLED');
    await enableVideoFor(B.org, tokenDirB);
    const camsB = await api('GET', '/video/cameras', tokenDirB);
    ok('B (flag on) : liste VIDE (pas les caméras de A)', camsB.status === 200 && Array.isArray(camsB.body) && camsB.body.length === 0, `n=${camsB.body?.length}`);
    const crossPatch = await api('PATCH', `/video/cameras/${cam.body.id}`, tokenDirB, { is_active: false });
    ok('B ne modifie pas la caméra de A (404)', crossPatch.status === 404, `status=${crossPatch.status}`);
    const stillActive = (await api('GET', '/video/cameras', tokenDirA)).body[0];
    ok('Caméra de A inchangée après tentative croisée', stillActive.is_active === true);

    // ── 4. Clips : presign + enregistrement ─────────────────────────────────
    console.log('\n4) Clips : presign S3 + enregistrement');
    const presign = await api('POST', '/video/clips/presign-upload', tokenDirA, { camera_id: cam.body.id, filename: 'incident-1432.mp4', mime_type: 'video/mp4' });
    ok('Presign : URL signée + storage_key', presign.status === 201 && Boolean(presign.body.upload_url?.includes('X-Amz-Signature')) && presign.body.storage_key?.startsWith(`${A.org}/video/`), JSON.stringify(presign.body).slice(0, 160));
    // Upload RÉEL simulé côté backend local (dev) : écriture du fichier.
    const clipKey = `${A.org}/video/${cam.body.id}/clip-reel.mp4`;
    const clipBytes = Buffer.from(`FAKE-MP4-BYTES-${randomUUID()}`);
    mkdirSync(dirname(join(storeDir, clipKey)), { recursive: true });
    writeFileSync(join(storeDir, clipKey), clipBytes);
    const clip = await api('POST', '/video/clips', tokenDirA, {
      camera_id: cam.body.id,
      captured_at: new Date(Date.now() - 3600_000).toISOString(),
      storage_key: clipKey,
      storage_backend: 'local',
      mime_type: 'video/mp4',
      size_bytes: clipBytes.length,
      duration_seconds: 42,
    });
    ok('Clip enregistré (backend local, taille réelle)', clip.status === 201 && Number(clip.body.size_bytes) === clipBytes.length, JSON.stringify(clip.body).slice(0, 140));
    const clipsA = await api('GET', '/video/clips', tokenDirA);
    const purgeAt = new Date(clipsA.body[0]?.purge_at).getTime();
    ok('Liste : purge_at ≈ uploaded_at + 30 j', clipsA.body.length === 1 && Math.abs(purgeAt - (Date.now() + 30 * 86400_000)) < 120_000, `purge_at=${purgeAt}`);

    // ── 5. Download + visionnage journalisé ─────────────────────────────────
    console.log('\n5) Visionnage journalisé (DPIA §5) + octets réels');
    const dl = await api('GET', `/video/clips/${clip.body.id}/download`, tokenDirA);
    ok('Download local → content_url', dl.status === 200 && dl.body.storage_backend === 'local' && Boolean(dl.body.content_url));
    const contentRes = await fetch(`${base}/video/clips/${clip.body.id}/content`, { headers: { authorization: `Bearer ${tokenDirA}` } });
    const contentBytes = Buffer.from(await contentRes.arrayBuffer());
    ok('Flux local : octets identiques au fichier uploadé', contentRes.status === 200 && contentBytes.equals(clipBytes), `${contentBytes.length} vs ${clipBytes.length}`);
    const views = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE resource_type='video_clip' AND resource_id=$1 AND action='read'`, [clip.body.id]);
    ok('Deux visionnages journalisés (download + content)', views.rows[0].n === 2, `n=${views.rows[0].n}`);

    // ── 6. Isolation clips ──────────────────────────────────────────────────
    console.log('\n6) Isolation des clips');
    const crossDl = await api('GET', `/video/clips/${clip.body.id}/download`, tokenDirB);
    ok('B ne télécharge pas le clip de A (404)', crossDl.status === 404, `status=${crossDl.status}`);
    const clipsB = await api('GET', '/video/clips', tokenDirB);
    ok('Liste des clips de B : vide', clipsB.status === 200 && clipsB.body.length === 0);
    const auditB = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE resource_type='video_clip' AND organization_id=$1`, [B.org]);
    ok('Aucune fuite d’audit vers B', auditB.rows[0].n === 0);

    // ── 7. Purge DPIA 30 jours (worker, fichier + ligne réels) ──────────────
    console.log('\n7) Purge à 30 jours (worker)');
    const freshClipId = (await db.query(
      `INSERT INTO video_clips (organization_id, camera_id, captured_at, storage_backend, storage_key, uploaded_by)
       VALUES ($1,$2,NOW() - INTERVAL '1 hour','local',$3,$4) RETURNING id`,
      [A.org, cam.body.id, `${A.org}/video/${cam.body.id}/recent.mp4`, A.director],
    )).rows[0].id;
    await db.query(`UPDATE video_clips SET uploaded_at = NOW() - INTERVAL '31 days' WHERE id=$1`, [clip.body.id]);
    await db.query(`INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'video_clips_purge', '{}', 1)`);
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl(), STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: storeDir },
      stdio: 'ignore',
    });
    const purged = await (async () => {
      for (let i = 0; i < 40; i += 1) {
        const r = await db.query(`SELECT COUNT(*)::int AS n FROM video_clips WHERE id=$1`, [clip.body.id]);
        const j = await db.query(`SELECT status FROM background_jobs WHERE job_type='video_clips_purge' ORDER BY created_at DESC LIMIT 1`);
        if (r.rows[0].n === 0 && j.rows[0]?.status === 'done') return true;
        await sleep(500);
      }
      return false;
    })();
    worker.kill(); worker = null;
    ok('Worker : ligne du clip expiré purgée (job done)', purged);
    ok('Fichier local réellement supprimé', !existsSync(join(storeDir, clipKey)));
    const fresh = await db.query(`SELECT COUNT(*)::int AS n FROM video_clips WHERE id=$1`, [freshClipId]);
    ok('Clip récent (< 30 j) conservé', fresh.rows[0].n === 1);

    // ── 8. Honnêteté S3 : jamais de fausse purge ────────────────────────────
    console.log('\n8) S3 injoignable → job ÉCHOUÉ (pas de fausse purge)');
    const s3ClipId = (await db.query(
      `INSERT INTO video_clips (organization_id, camera_id, captured_at, storage_backend, storage_key, uploaded_by, uploaded_at)
       VALUES ($1,$2,NOW() - INTERVAL '40 days','s3',$3,$4,NOW() - INTERVAL '40 days') RETURNING id`,
      [A.org, cam.body.id, `${A.org}/video/${cam.body.id}/ancien.mp4`, A.director],
    )).rows[0].id;
    await db.query(`INSERT INTO background_jobs (organization_id, job_type, payload, priority) VALUES (NULL, 'video_clips_purge', '{}', 1)`);
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl(), STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: storeDir, S3_ENDPOINT: 'http://127.0.0.1:9/injoignable' },
      stdio: 'ignore',
    });
    const failedHonest = await (async () => {
      // Le retry exponentiel laisse le job en 'pending' entre essais (comme
      // phase16) : le signal honnête est le failure_reason explicite, posé
      // dès le premier essai — le statut 'failed' final n'arrive qu'après
      // max_attempts.
      for (let i = 0; i < 80; i += 1) {
        const j = await db.query(`SELECT status, failure_reason FROM background_jobs WHERE job_type='video_clips_purge' ORDER BY created_at DESC, attempts DESC LIMIT 1`);
        if (j.rows[0]?.failure_reason != null) return j.rows[0];
        await sleep(500);
      }
      return null;
    })();
    worker.kill(); worker = null;
    ok('Job purge : échec explicite VIDEO_PURGE_PARTIAL (jamais de fausse purge)',
      Boolean(failedHonest && failedHonest.failure_reason?.includes('VIDEO_PURGE_PARTIAL')),
      JSON.stringify(failedHonest));
    const s3Row = await db.query(`SELECT COUNT(*)::int AS n FROM video_clips WHERE id=$1`, [s3ClipId]);
    ok('Ligne S3 NON purgée (conservée pour réessai)', s3Row.rows[0].n === 1);
  } finally {
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM background_jobs WHERE job_type='video_clips_purge'`);
      await db.query(`DELETE FROM video_clips WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM video_cameras WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM privacy_dpias WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM memberships WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN ($1,$2)`, [orgA, orgB]);
      await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}%`]);
      await db.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    } catch (cleanupError) {
      console.error('Nettoyage phase21 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 21 vidéosurveillance : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 21 vidéosurveillance validée (8 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
