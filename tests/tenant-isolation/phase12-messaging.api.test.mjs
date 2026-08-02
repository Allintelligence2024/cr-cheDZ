#!/usr/bin/env node
/**
 * Phase 12 (roadmap v2) — messagerie, avec deux tenants A/B, sur PostgreSQL
 * réel avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. la directrice de A crée une conversation pour un enfant — les gardiens
 *      de l'enfant sont participants automatiquement ;
 *   2. un parent de A (gardien) liste/consulte la conversation et envoie un
 *      message ;
 *   3. un utilisateur de A NON participant ne voit pas la conversation (404) ;
 *   4. un utilisateur de B ne voit pas la conversation de A (404, RLS) et ne
 *      peut pas y envoyer de message ;
 *   5. la directrice de B ne crée pas de conversation pour l'enfant de A (404) ;
 *   6. marquage « lu » par un participant ;
 *   7. le staff de A liste ses conversations (participant).
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

  const tag = `msg-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const parentRole = (await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`)).rows[0].id;
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'M','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const childA = (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'MSG-A1','Yanis','Test','2024-01-01',$4) RETURNING id`, [A.org, A.site, A.room, A.director],
    )).rows[0].id;
    const mkParent = async (email, orgId, childId) => {
      const u = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u, parentRole]);
      const g = (await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`, [orgId, u, A.director])).rows[0].id;
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal) VALUES($1,$2,$3,true)`, [orgId, childId, g]);
      return u;
    };
    const parentA = await mkParent(`${tag}-pa@test.dz`, A.org, childA);
    const parentB = await mkParent(`${tag}-pb@test.dz`, B.org, childA); // parent de B lié à l'enfant de A (données croisées volontaires)
    // Utilisateur de A NON participant
    const outsiderA = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'O','T',$2,'active') RETURNING id`, [`${tag}-out@test.dz`, hash])).rows[0].id;
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [A.org, outsiderA, parentRole]);

    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenPA = (await api('POST', '/auth/login', null, { email: `${tag}-pa@test.dz`, password })).body.access_token;
    const tokenPB = (await api('POST', '/auth/login', null, { email: `${tag}-pb@test.dz`, password })).body.access_token;
    const tokenOut = (await api('POST', '/auth/login', null, { email: `${tag}-out@test.dz`, password })).body.access_token;
    ok('JWT émis', Boolean(tokenDirA && tokenDirB && tokenPA && tokenPB && tokenOut));

    // ── 1. Création par la directrice A (gardiens auto-ajoutés) ─────────────
    console.log('\n1) Création de conversation (staff A)');
    const conv = await api('POST', '/messaging/conversations', tokenDirA, {
      child_id: childA, subject: 'Question repas',
    });
    ok('Conversation créée (201)', conv.status === 201, JSON.stringify(conv.body).slice(0, 120));
    const convId = conv.body.id;
    const participants = await db.query(
      `SELECT user_id FROM conversation_participants WHERE conversation_id=$1`,
      [convId],
    );
    const pIds = participants.rows.map((r) => r.user_id);
    ok('Participants : directrice + gardien de A (pas le parent de B)', pIds.includes(A.director) && pIds.includes(parentA) && !pIds.includes(parentB), JSON.stringify(pIds));

    // ── 2/3. Parent A participe ; outsider A non ────────────────────────────
    console.log('\n2-3) Accès participant vs non-participant');
    const listPA = await api('GET', '/messaging/conversations', tokenPA);
    ok('Parent A : conversation visible dans sa liste', listPA.status === 200 && listPA.body.some((c) => c.id === convId), JSON.stringify(listPA.body).slice(0, 150));
    const detailPA = await api('GET', `/messaging/conversations/${convId}`, tokenPA);
    ok('Parent A : détail accessible', detailPA.status === 200 && Array.isArray(detailPA.body.messages), JSON.stringify(detailPA.body).slice(0, 100));
    const sendPA = await api('POST', `/messaging/conversations/${convId}/messages`, tokenPA, { body: 'Bonjour, question sur le repas' });
    ok('Parent A : message envoyé', sendPA.status === 201, JSON.stringify(sendPA.body).slice(0, 100));
    const detailAfter = await api('GET', `/messaging/conversations/${convId}`, tokenDirA);
    ok('Directrice A : voit le message du parent', detailAfter.status === 200 && detailAfter.body.messages.length === 1 && detailAfter.body.messages[0].body.includes('Bonjour'));
    ok('Outsider A : détail → 404', (await api('GET', `/messaging/conversations/${convId}`, tokenOut)).status === 404);
    ok('Outsider A : envoi → 404', (await api('POST', `/messaging/conversations/${convId}/messages`, tokenOut, { body: 'spam' })).status === 404);
    const listOut = await api('GET', '/messaging/conversations', tokenOut);
    ok('Outsider A : liste vide', listOut.status === 200 && listOut.body.length === 0);

    // ── 4/5. Isolation org B ────────────────────────────────────────────────
    console.log('\n4-5) Isolation (org B)');
    ok('Directeur B : détail de la conversation de A → 404', (await api('GET', `/messaging/conversations/${convId}`, tokenDirB)).status === 404);
    ok('Directeur B : envoi dans la conversation de A → 404', (await api('POST', `/messaging/conversations/${convId}/messages`, tokenDirB, { body: 'intrusion' })).status === 404);
    const listB = await api('GET', '/messaging/conversations', tokenDirB);
    ok('Directeur B : liste sans la conversation de A', listB.status === 200 && listB.body.length === 0);
    ok('Parent B : détail de la conversation de A → 404', (await api('GET', `/messaging/conversations/${convId}`, tokenPB)).status === 404);
    ok('Directeur B : création pour l’enfant de A → 404', (await api('POST', '/messaging/conversations', tokenDirB, { child_id: childA })).status === 404);

    // ── 6. Marquage lu ──────────────────────────────────────────────────────
    console.log('\n6) Marquage « lu »');
    const read = await api('POST', `/messaging/conversations/${convId}/read`, tokenPA, {});
    ok('Parent A : marquage lu → 200', read.status === 200 || read.status === 201, JSON.stringify(read.body).slice(0, 80));
    const lastRead = await db.query(`SELECT last_read_at FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2`, [convId, parentA]);
    ok('last_read_at posé', Boolean(lastRead.rows[0].last_read_at));

    // ── 7. Staff : liste des conversations ──────────────────────────────────
    console.log('\n7) Staff A : liste');
    const listDirA = await api('GET', '/messaging/conversations', tokenDirA);
    ok('Directrice A : conversation dans sa liste (avec nb messages)', listDirA.status === 200 && listDirA.body.length === 1 && listDirA.body[0].message_count === 1, JSON.stringify(listDirA.body).slice(0, 120));
  } finally {
    try {
      await db.query(`DELETE FROM messages WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM conversation_participants WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM conversations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'msg-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'msg-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'msg-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'msg-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'msg-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase12-messaging partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 12 messagerie : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 12 messagerie validée (7 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
