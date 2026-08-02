#!/usr/bin/env node
/**
 * Phase 16 (roadmap v2) — WhatsApp Business API, avec deux tenants A/B, sur
 * PostgreSQL réel avec le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. flag whatsapp_notifications off → AUCUNE notification whatsapp en file
 *      (le canal push/inbox reste alimenté) ;
 *   2. flag on + gardien avec téléphone → notification whatsapp mise en file
 *      (destinataire = téléphone du gardien) ;
 *   3. gardien sans téléphone → rien en file whatsapp ;
 *   4. flag on pour A seulement → B ne met RIEN en file whatsapp pour ses
 *      gardiens (flag scoped par tenant) ;
 *   5. worker sans config WHATSAPP_* → la notification whatsapp n'est JAMAIS
 *      marquée 'sent' : elle passe en échec avec failure_reason
 *      WHATSAPP_NOT_CONFIGURED (jamais de faux statut) ;
 *   6. les notifications push/inbox de A restent indépendantes (non affectées).
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API + worker compilés (dist/).
 */
import { execSync, spawn } from 'node:child_process';
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
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
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

  const tag = `wa-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  let worker;

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'W','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const mkChild = async (org, ref) => (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,$4,'Y','T','2024-01-01',$5) RETURNING id`, [org.org, org.site, org.room, ref, org.director],
    )).rows[0].id;
    const childA = await mkChild(A, 'WA-A1');
    const childB = await mkChild(B, 'WA-B1');

    // Gardiens : A1 avec téléphone, A2 sans téléphone ; B1 avec téléphone
    const mkGuardian = async (orgId, childId, email, phone) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,(SELECT id FROM roles WHERE slug='parent_primary'),true,NOW())`, [orgId, u]);
      const g = (await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by) VALUES($1,$2,'P','T','parent',$3,$4) RETURNING id`, [orgId, u, phone ?? null, orgId === A.org ? A.director : B.director])).rows[0].id;
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_receive_push) VALUES($1,$2,$3,true)`, [orgId, childId, g]);
      return u;
    };
    const gA1 = await mkGuardian(A.org, childA, `${tag}-a1@test.dz`, `+213${String(600000000 + Math.floor(Math.random() * 100000000))}`);
    const gA2 = await mkGuardian(A.org, childA, `${tag}-a2@test.dz`, null);
    const gB1 = await mkGuardian(B.org, childB, `${tag}-b1@test.dz`, `+213${String(600000000 + Math.floor(Math.random() * 100000000))}`);

    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenDirA && tokenDirB));

    // ── 1. Flag off → pas de whatsapp en file ───────────────────────────────
    console.log('\n1) Flag whatsapp_notifications désactivé (défaut)');
    await api('POST', '/attendance/check-in', tokenDirA, { child_id: childA });
    const waBefore = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp'`,
      [A.org],
    );
    ok('Flag off : aucune notification whatsapp en file', waBefore.rows[0].n === 0, `n=${waBefore.rows[0].n}`);

    // ── 2/3. Flag on → file whatsapp pour gardien avec téléphone uniquement ─
    console.log('\n2-3) Flag activé pour A');
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('whatsapp_notifications', $1, true)`, [A.org]);
    await api('POST', '/journal/events', tokenDirA, { child_id: childA, event_type: 'meal', meal_type: 'lunch', occurred_at: new Date().toISOString() });
    const waRows = await db.query(
      `SELECT user_id, data->>'to' AS to_phone FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp'`,
      [A.org],
    );
    ok('Flag on : 1 notification whatsapp en file (gardien avec téléphone)', waRows.rows.length === 1 && waRows.rows[0].user_id === gA1, JSON.stringify(waRows.rows));
    ok('Destinataire = téléphone du gardien (data.to)', Boolean(waRows.rows[0].to_phone?.startsWith('+213')), waRows.rows[0].to_phone);
    const gA2Wa = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp' AND user_id=$2`,
      [A.org, gA2],
    );
    ok('Gardien sans téléphone : rien en file whatsapp', gA2Wa.rows[0].n === 0);

    // ── 4. Flag scoped : B n'a pas le flag → rien chez B ────────────────────
    console.log('\n4) Flag scoped par tenant');
    await api('POST', '/attendance/check-in', tokenDirB, { child_id: childB });
    const waB = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp'`,
      [B.org],
    );
    ok('B (sans flag) : aucune notification whatsapp', waB.rows[0].n === 0, `n=${waB.rows[0].n}`);

    // ── 5. Worker sans config → jamais 'sent' ───────────────────────────────
    console.log('\n5) Worker sans config WHATSAPP_*');
    worker = spawn('node', ['apps/worker/dist/main.js'], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: appUrl() },
      stdio: 'ignore',
    });
    const processed = await (async () => {
      for (let i = 0; i < 40; i += 1) {
        const r = await db.query(
          `SELECT status, failure_reason FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp'`,
          [A.org],
        );
        // Traitée = au moins un essai effectué (failure_reason posé) ou
        // statut terminal (failed) — le retry exponentiel peut laisser
        // 'pending' entre deux essais.
        if (r.rows[0]?.failure_reason != null || r.rows[0]?.status === 'failed') return r.rows[0];
        await sleep(500);
      }
      return null;
    })();
    ok('Notification whatsapp traitée par le worker', Boolean(processed), JSON.stringify(processed));
    const waState = await db.query(
      `SELECT status, failure_reason FROM notification_queue WHERE organization_id=$1 AND channel='whatsapp'`,
      [A.org],
    );
    ok('Sans config : JAMAIS marquée sent (failed ou pending + WHATSAPP_NOT_CONFIGURED)',
      waState.rows[0].status !== 'sent' && (waState.rows[0].failure_reason ?? '').includes('WHATSAPP_NOT_CONFIGURED'),
      JSON.stringify(waState.rows[0]));

    // ── 6. Push/inbox indépendants ──────────────────────────────────────────
    console.log('\n6) Push et inbox non affectés');
    const pushRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_queue WHERE organization_id=$1 AND channel='push'`,
      [A.org],
    );
    const inboxRows = await db.query(
      `SELECT COUNT(*)::int AS n FROM notification_inbox WHERE organization_id=$1`,
      [A.org],
    );
    ok('Canal push toujours alimenté (check-in + meal)', pushRows.rows[0].n >= 2, `n=${pushRows.rows[0].n}`);
    ok('Inbox toujours alimentée', inboxRows.rows[0].n >= 2, `n=${inboxRows.rows[0].n}`);
    void gB1;
  } finally {
    if (worker) worker.kill();
    try {
      await db.query(`DELETE FROM notification_queue WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM notification_inbox WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'wa-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'wa-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'wa-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'wa-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'wa-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase16 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 16 WhatsApp : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 16 WhatsApp validée (6 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
