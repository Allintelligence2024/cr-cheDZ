#!/usr/bin/env node
/**
 * Phase 77 — GARDE DE PAYLOAD SYNCHRONISATION (audit 2026-09-24 constat 33 ;
 * décision D6 au plan de réparation §6 ; lot L2E).
 *
 * Le problème mesuré
 * ------------------
 * Le chemin photo hors-ligne du client met les octets en **base64 dans le
 * payload** de l'opération `add_photo` :
 * `apps/staff-mobile/lib/core/media/media_uploader.dart` →
 * `'bytes': base64Encode(bytes)`. Or le serveur **stocke le payload verbatim**
 * dans `sync_operations.payload` (JSONB, sans plafond) et le handler
 * `add_photo` **ne consomme pas** ce champ : l'opération est « accepted »,
 * l'asset naît **sans octets** (lecture → `404 MEDIA_CONTENT_MISSING`), et la
 * photo de l'enfant reste néanmoins dans l'historique de synchronisation — hors
 * du pipeline média (consentements, `is_visible_to_parents`, journal des accès,
 * purge dédiée).
 *
 * Ce que la suite prouve (API réelle + PostgreSQL réel + rôle applicatif)
 * ----------------------------------------------------------------------
 *   1. `add_photo` SANS octets → **rejected** `OFFLINE_PHOTO_UNSUPPORTED` :
 *      depuis la décision D6 (option c), la photo hors ligne est retirée — la
 *      commande ne crée plus d'asset sans octets (un test vérifie qu'aucun
 *      `media_assets` n'apparaît) ;
 *   2. `add_photo` avec des octets base64 (champ `bytes`, comme le client) →
 *      **rejected** `PAYLOAD_BINARY_NOT_ALLOWED`, message nommant la route
 *      correcte (`POST /api/v1/media/upload`) ;
 *   3. **rien n'est persisté** : aucune ligne `sync_operations` pour cet
 *      `event_id`, aucun `media_assets` — ce qu'on refuse de stocker n'atteint
 *      pas la base, même en « rejected » ;
 *   4. le renommage du champ (`photo_data`, `content`) ne contourne PAS la règle
 *      (contrôle de FORME, pas de nom) ;
 *   5. un payload volumineux mais LÉGITIME (note longue d'une éducatrice, avec
 *      espaces et accents) est **accepté** : le garde ne bloque pas l'usage
 *      normal, seulement le transport d'octets et les payloads hors bornes ;
 *   6. un payload au-delà du plafond (16 Ko) → **rejected**
 *      `PAYLOAD_TOO_LARGE_FOR_SYNC` ;
 *   7. un envoi très volumineux (300 Ko) est refusé **avant** le service (limite
 *      du corps HTTP) : la contrainte de D6 est double, et le fait est consigné ;
 *   8. les autres commandes (`log_temperature`, `check_in`) ne sont pas
 *      affectées.
 *
 * Prérequis : apps/api compilé (dist/), PostgreSQL 18 réel, migrations à jour.
 * Usage : node tests/tenant-isolation/phase77-sync-payload-guard.api.test.mjs
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

/** Octets d'une « photo » de ~6 Ko encodés en base64 (comme le client). */
const PHOTO_BYTES_B64 = Buffer.alloc(4500, 7).toString('base64');

const operation = (command, entityType, payload, overrides = {}) => ({
  event_id: randomUUID(),
  client_sequence: 1,
  schema_version: 1,
  command,
  entity_type: entityType,
  payload,
  occurred_at_device: new Date().toISOString(),
  ...overrides,
});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('phase77 : base *_test uniquement');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? '/tmp/pgtest/p77store';

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  const api = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);
  const tag = randomUUID().slice(0, 8);
  let orgId; let userId; let childId; let deviceId;

  try {
    // ── Fixtures : une organisation, une directrice, un enfant, un appareil
    const directorRole = (await admin.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    orgId = (await admin.query(
      `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P77','31') RETURNING id`, [`p77-${tag}`],
    )).rows[0].id;
    const site = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [orgId])).rows[0].id;
    const room = (await admin.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',15) RETURNING id`, [orgId, site])).rows[0].id;
    userId = (await admin.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','P77',$2,'active') RETURNING id`,
      [`p77-${tag}@test.dz`, hash],
    )).rows[0].id;
    await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, userId, directorRole]);
    childId = (await admin.query(
      `INSERT INTO children(organization_id,site_id,room_id,first_name_fr,last_name_fr,date_of_birth,status,created_by)
       VALUES($1,$2,$3,'Nour','P77','2024-03-01','active',$4) RETURNING id`,
      [orgId, site, room, userId],
    )).rows[0].id;

    const login = await api('POST', '/auth/login', null, { email: `p77-${tag}@test.dz`, password });
    check('setup : connexion de la directrice', login.status === 200, JSON.stringify(login.body).slice(0, 120));
    const token = login.body.access_token;
    const device = await api('POST', '/devices', token, {
      name: 'Tablette P77', device_fingerprint: `p77-${tag}`, platform: 'android',
    });
    check('setup : appareil enregistré', device.status === 201, JSON.stringify(device.body).slice(0, 120));
    deviceId = device.body.device_id;

    const rowCount = async (sql, params) => (await admin.query(sql, params)).rows[0].n;

    // ── 1. Chemin légitime : add_photo SANS octets → accepted
    const legit = operation('add_photo', 'media', {
      child_id: childId,
      storage_key: `${orgId}/photo/offline-1.jpg`,
      mime_type: 'image/jpeg',
      checksum: 'abc123',
    });
    const pushLegit = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [legit] });
    check('1. add_photo SANS octets → rejected OFFLINE_PHOTO_UNSUPPORTED (D6 option c)',
      pushLegit.status === 200 && pushLegit.body.rejected?.length === 1
        && pushLegit.body.rejected[0].reason === 'OFFLINE_PHOTO_UNSUPPORTED',
      JSON.stringify(pushLegit.body).slice(0, 220));
    check('1bis. aucune ligne media_assets créée par la voie hors ligne',
      (await rowCount(`SELECT count(*)::int AS n FROM media_assets WHERE storage_key = $1`,
        [`${orgId}/photo/offline-1.jpg`])) === 0);

    // ── 2. Octets base64 (le champ du client) → rejected, route nommée
    const withBytes = operation('add_photo', 'media', {
      child_id: childId,
      storage_key: `${orgId}/photo/offline-bytes.jpg`,
      mime_type: 'image/jpeg',
      checksum: 'def456',
      bytes: PHOTO_BYTES_B64,
    });
    const pushBytes = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [withBytes] });
    const rejected = pushBytes.body.rejected?.find((r) => r.event_id === withBytes.event_id);
    check('2. add_photo avec octets base64 → rejected PAYLOAD_BINARY_NOT_ALLOWED',
      pushBytes.status === 200 && rejected?.reason === 'PAYLOAD_BINARY_NOT_ALLOWED',
      JSON.stringify(pushBytes.body).slice(0, 220));
    check('2bis. le message nomme la route correcte (POST /api/v1/media/upload)',
      typeof rejected?.message === 'string' && rejected.message.includes('/media/upload'),
      rejected?.message ?? '(aucun message)');

    // ── 3. Rien n'est persisté : ni l'opération, ni un asset fantôme
    const opStored = await rowCount(`SELECT count(*)::int AS n FROM sync_operations WHERE event_id = $1`, [withBytes.event_id]);
    check('3. aucune ligne sync_operations (le payload n’est PAS stocké)',
      opStored === 0, `lignes=${opStored}`);
    const assetStored = await rowCount(`SELECT count(*)::int AS n FROM media_assets WHERE storage_key = $1`, [`${orgId}/photo/offline-bytes.jpg`]);
    check('3bis. aucun media_assets fantôme (pas d’effet partiel)',
      assetStored === 0, `assets=${assetStored}`);

    // ── 4. Un champ RENOMMÉ ne contourne pas la règle (contrôle de forme)
    for (const field of ['photo_data', 'content', 'image_base64']) {
      const renamed = operation('add_photo', 'media', {
        child_id: childId,
        storage_key: `${orgId}/photo/offline-${field}.jpg`,
        mime_type: 'image/jpeg',
        [field]: PHOTO_BYTES_B64,
      });
      const pushRenamed = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [renamed] });
      const r = pushRenamed.body.rejected?.find((x) => x.event_id === renamed.event_id);
      check(`4. champ renommé « ${field} » → rejected PAYLOAD_BINARY_NOT_ALLOWED`,
        r?.reason === 'PAYLOAD_BINARY_NOT_ALLOWED', JSON.stringify(pushRenamed.body).slice(0, 180));
    }

    // ── 5. Payload volumineux mais LÉGITIME (note longue) → accepted
    const longNote = 'Note pédagogique : '.repeat(20) + 'L’enfant a mangé de bon appétit, sieste calme. '.repeat(60);
    const legitNote = operation('log_note', 'daily_log', { child_id: childId, note_text: longNote });
    const pushNote = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [legitNote] });
    check(`5. note légitime de ${longNote.length} caractères → accepted (le garde ne bloque pas l’usage normal)`,
      pushNote.status === 200 && pushNote.body.accepted?.length === 1,
      JSON.stringify(pushNote.body).slice(0, 200));

    // ── 6. Payload au-delà du plafond → rejected (raison dédiée)
    const tooLarge = operation('log_note', 'daily_log', { child_id: childId, note_text: 'x'.repeat(20 * 1024) });
    const pushLarge = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [tooLarge] });
    const rl = pushLarge.body.rejected?.find((x) => x.event_id === tooLarge.event_id);
    check('6. payload de 20 Ko → rejected PAYLOAD_TOO_LARGE_FOR_SYNC',
      rl?.reason === 'PAYLOAD_TOO_LARGE_FOR_SYNC', JSON.stringify(pushLarge.body).slice(0, 200));
    check('6bis. ce refus n’est pas persisté non plus',
      (await rowCount(`SELECT count(*)::int AS n FROM sync_operations WHERE event_id = $1`, [tooLarge.event_id])) === 0);

    // ── 7. Envoi très volumineux : refusé AVANT le service (limite HTTP du corps)
    //     Fait consigné pour D6 : la contrainte n'est pas seulement applicative.
    const huge = operation('add_photo', 'media', {
      child_id: childId, storage_key: `${orgId}/photo/huge.jpg`, mime_type: 'image/jpeg',
      bytes: Buffer.alloc(300 * 1024, 9).toString('base64'),
    });
    const pushHuge = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [huge] });
    check('7. envoi de ~300 Ko → 413 PAYLOAD_TOO_LARGE (jamais 500 « erreur interne »)',
      pushHuge.status === 413 && pushHuge.body?.code === 'PAYLOAD_TOO_LARGE',
      `status=${pushHuge.status} code=${pushHuge.body?.code}`);
    check('7ter. le message bilingue parle de la taille, pas d’une panne serveur',
      typeof pushHuge.body?.message_fr === 'string' && /volumineux/i.test(pushHuge.body.message_fr)
      && typeof pushHuge.body?.message_ar === 'string' && pushHuge.body.message_ar.length > 0,
      JSON.stringify({ fr: pushHuge.body?.message_fr, ar: pushHuge.body?.message_ar }));
    check('7bis. rien n’est persisté pour cet envoi',
      (await rowCount(`SELECT count(*)::int AS n FROM sync_operations WHERE event_id = $1`, [huge.event_id])) === 0);

    // ── 8. Les autres commandes ne sont pas affectées
    const temp = operation('log_temperature', 'daily_log', { child_id: childId, temperature_celsius: 36.8 });
    const pushTemp = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [temp] });
    check('8. log_temperature normale → accepted (aucune régression)',
      pushTemp.status === 200 && pushTemp.body.accepted?.length === 1,
      JSON.stringify(pushTemp.body).slice(0, 200));

    // ── 9. Le refus est déterministe : rejouer le MÊME event_id donne la même
    //      réponse, toujours sans écriture (idempotence par nature).
    const retry = await api('POST', '/sync/push', token, { device_id: deviceId, operations: [withBytes] });
    const rretry = retry.body.rejected?.find((x) => x.event_id === withBytes.event_id);
    check('9. rejeu du même event_id → même refus, toujours rien en base',
      rretry?.reason === 'PAYLOAD_BINARY_NOT_ALLOWED'
      && (await rowCount(`SELECT count(*)::int AS n FROM sync_operations WHERE event_id = $1`, [withBytes.event_id])) === 0);
  } finally {
    try {
      if (orgId) {
        await admin.query(`DELETE FROM sync_operations WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM sync_changelog WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM daily_log_events WHERE organization_id = $1`, [orgId]).catch(() => {});
        await admin.query(`DELETE FROM media_assets WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM devices WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM children WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM memberships WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
        await admin.query(`DELETE FROM users WHERE id = $1`, [userId]);
        await admin.query(`DELETE FROM rooms WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM sites WHERE organization_id = $1`, [orgId]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      }
    } catch (cleanupError) {
      console.error('Nettoyage phase77 partiel :', cleanupError.message);
    }
    await app.close();
    await admin.end();
  }

  if (failures.length) {
    console.error(`\n✗ Phase 77 — garde de payload synchronisation : ${failures.length} échec(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 77 — garde de payload synchronisation validée (9 cas) sur PostgreSQL réel.');
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
