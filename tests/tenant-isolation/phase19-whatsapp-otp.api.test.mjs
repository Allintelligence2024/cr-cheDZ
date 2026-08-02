#!/usr/bin/env node
/**
 * Phase 19 (roadmap v2) — OTP de connexion parent via WhatsApp, sur
 * PostgreSQL réel avec le rôle NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. flag whatsapp_otp absent/off → 422 WHATSAPP_OTP_DISABLED (bilingue) ;
 *   2. canal invalide → 400 ;
 *   3. défaut = SMS : 200, channel 'sms', otp_codes.channel='sms' ;
 *   4. flag activé (console support) → OTP whatsapp : 200, channel
 *      'whatsapp', otp_codes.channel='whatsapp', et la nouvelle demande
 *      invalide le code SMS précédent (verify échoue) ;
 *   5. roundtrip : mauvais code → 401 OTP_INVALID ; bon code → tokens parent ;
 *   6. désactivation du flag → 422 à nouveau (le dernier statut gagne) ;
 *   7. honnêteté fournisseur : WhatsAppService sans WHATSAPP_TOKEN/PHONE_ID
 *      → AppError 503 WHATSAPP_NOT_CONFIGURED (jamais de faux « envoyé »).
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

  const tag = `wotp-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const phone = `+213${String(600000000 + Math.floor(Math.random() * 100000000))}`;
  let org = null;

  try {
    // ── Setup : org + parent avec téléphone (users.phone + guardians) ────────
    org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'W','31') RETURNING id`, [tag])).rows[0].id;
    const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
    const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
    const parentRole = (await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`)).rows[0].id;
    const parent = (await db.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status,phone) VALUES($1,'P','T',$2,'active',$3) RETURNING id`,
      [`${tag}-parent@test.dz`, hash, phone],
    )).rows[0].id;
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, parent, parentRole]);
    await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by) VALUES($1,$2,'P','T','parent',$3,$2)`, [org, parent, phone]);
    void room;
    const superAdmin = (await db.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'S','A',$2,'active',true) RETURNING id`,
      [`${tag}-super@test.dz`, hash],
    )).rows[0].id;
    const tokenSuper = (await api('POST', '/auth/login', null, { email: `${tag}-super@test.dz`, password })).body.access_token;
    ok('JWT super_admin émis', Boolean(tokenSuper));

    // ── 1. Flag off → 422 bilingue ──────────────────────────────────────────
    console.log('\n1) Flag whatsapp_otp désactivé (défaut)');
    const blocked = await api('POST', '/auth/parent/otp/request', null, { phone, channel: 'whatsapp' });
    ok('Sans flag : 422 WHATSAPP_OTP_DISABLED', blocked.status === 422 && blocked.body.code === 'WHATSAPP_OTP_DISABLED', JSON.stringify(blocked.body).slice(0, 140));
    ok('Message bilingue FR + AR', Boolean(blocked.body.message_fr && blocked.body.message_ar), JSON.stringify(blocked.body).slice(0, 200));

    // ── 2. Canal invalide → 400 ─────────────────────────────────────────────
    console.log('\n2) Canal invalide');
    const badChannel = await api('POST', '/auth/parent/otp/request', null, { phone, channel: 'pigeon' });
    ok('channel inconnu → 400', badChannel.status === 400, `status=${badChannel.status}`);

    // ── 3. Défaut SMS ────────────────────────────────────────────────────────
    console.log('\n3) Canal par défaut (sms)');
    const smsReq = await api('POST', '/auth/parent/otp/request', null, { phone });
    ok('Sans channel : 200 channel=sms + development_code (test)', smsReq.status === 200 && smsReq.body.channel === 'sms' && Boolean(smsReq.body.development_code), JSON.stringify(smsReq.body).slice(0, 140));
    const smsRow = (await db.query(`SELECT channel FROM otp_codes WHERE target=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`, [phone])).rows[0];
    ok('otp_codes.channel = sms', smsRow?.channel === 'sms', JSON.stringify(smsRow));
    const smsCode = smsReq.body.development_code;

    // ── 4. Flag on → WhatsApp ───────────────────────────────────────────────
    console.log('\n4) Flag whatsapp_otp activé via la console support');
    const setFlag = await api('POST', '/support/flags/whatsapp_otp', tokenSuper, { is_enabled: true });
    ok('Activation du flag (super_admin) : 200/201', setFlag.status === 200 || setFlag.status === 201, `status=${setFlag.status}`);
    const waReq = await api('POST', '/auth/parent/otp/request', null, { phone, channel: 'whatsapp' });
    ok('Flag on : 200 channel=whatsapp + development_code (test)', waReq.status === 200 && waReq.body.channel === 'whatsapp' && Boolean(waReq.body.development_code), JSON.stringify(waReq.body).slice(0, 160));
    const waRow = (await db.query(`SELECT channel FROM otp_codes WHERE target=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`, [phone])).rows[0];
    ok('otp_codes.channel = whatsapp', waRow?.channel === 'whatsapp', JSON.stringify(waRow));

    // ── 5. Roundtrip de connexion ───────────────────────────────────────────
    console.log('\n5) Vérification du code WhatsApp');
    const oldVerify = await api('POST', '/auth/parent/otp/verify', null, { phone, code: smsCode });
    ok('Ancien code SMS invalidé par la nouvelle demande → 401', oldVerify.status === 401 && oldVerify.body.code === 'OTP_INVALID', JSON.stringify(oldVerify.body).slice(0, 120));
    const wrong = await api('POST', '/auth/parent/otp/verify', null, { phone, code: '000000' });
    ok('Mauvais code → 401 OTP_INVALID', wrong.status === 401 && wrong.body.code === 'OTP_INVALID');
    const good = await api('POST', '/auth/parent/otp/verify', null, { phone, code: waReq.body.development_code });
    ok('Bon code (WhatsApp) → tokens émis', good.status === 200 && Boolean(good.body.access_token && good.body.refresh_token), JSON.stringify(good.body).slice(0, 120));
    ok('Rôle parent dans la session', good.body.user?.role === 'parent_primary' && good.body.user?.organization_id === org, JSON.stringify(good.body.user ?? {}));

    // ── 6. Désactivation → 422 à nouveau ────────────────────────────────────
    console.log('\n6) Flag re-désactivé');
    await api('POST', '/support/flags/whatsapp_otp', tokenSuper, { is_enabled: false });
    const blockedAgain = await api('POST', '/auth/parent/otp/request', null, { phone, channel: 'whatsapp' });
    ok('Après désactivation : 422 WHATSAPP_OTP_DISABLED', blockedAgain.status === 422 && blockedAgain.body.code === 'WHATSAPP_OTP_DISABLED', `status=${blockedAgain.status} ${JSON.stringify(blockedAgain.body).slice(0, 100)}`);
    const smsStill = await api('POST', '/auth/parent/otp/request', null, { phone });
    ok('Le canal SMS reste disponible', smsStill.status === 200);

    // ── 7. Honnêteté fournisseur (service compilé, sans config) ─────────────
    console.log('\n7) Jamais de faux « envoyé » sans configuration');
    const { WhatsAppService } = await import(pathToFileURL(join(repo, 'apps/api/dist/shared/whatsapp/whatsapp.service.js')).href);
    const bare = new WhatsAppService({ get: () => undefined });
    let code7 = null; let status7 = null;
    try { await bare.send('+213600000000', 'test'); } catch (e) { code7 = e.code; status7 = e.status; }
    ok('WhatsAppService sans config → 503 WHATSAPP_NOT_CONFIGURED', code7 === 'WHATSAPP_NOT_CONFIGURED' && status7 === 503, `code=${code7} status=${status7}`);
  } finally {
    try {
      await db.query(`DELETE FROM otp_codes WHERE target=$1`, [phone]);
      await db.query(`DELETE FROM guardians WHERE organization_id=$1`, [org]);
      await db.query(`DELETE FROM memberships WHERE organization_id=$1`, [org]);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${tag}%`]);
      await db.query(`DELETE FROM rooms WHERE organization_id=$1`, [org]);
      await db.query(`DELETE FROM sites WHERE organization_id=$1`, [org]);
      await db.query(`DELETE FROM org_sequences WHERE organization_id=$1`, [org]);
      await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}%`]);
      await db.query(`DELETE FROM organizations WHERE slug=$1`, [tag]);
      // Restaure l'état seedé du flag (le test a créé des doublons NULL org)
      await db.query(`DELETE FROM feature_flags WHERE flag_key='whatsapp_otp'`);
      await db.query(`INSERT INTO feature_flags (flag_key, is_enabled, description) VALUES ('whatsapp_otp', false, 'OTP de connexion parent via WhatsApp')`);
    } catch (cleanupError) {
      console.error('Nettoyage phase19 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 19 WhatsApp OTP : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 19 WhatsApp OTP validée (7 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
