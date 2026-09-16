#!/usr/bin/env node
// H2l — staging anonymization: canaries in every covered PII column, whole-DB
// residual scan, row-count (no-purge) and referential guards, real login after
// uniform staging password, transactional self-check, DB-name guard.
// Run on a FRESH base (last suite of the battery) — it rewrites the test data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { ensureAppRole } from './helpers.mjs';

const ADMIN_URL = process.env.DATABASE_URL;
assert.ok(new URL(ADMIN_URL).pathname.endsWith('_test'), 'Base jetable *_test uniquement');
const TAG = Date.now().toString(36);
const C = (name) => `CANARY-${TAG}-${name}`;
const STAGING_PASSWORD = 'Creche#Staging2026!';
const BCRYPT_STAGING_HASH = '$2b$10$9GU3qPihQLccTzRcSSUY.e1q8eIlhacVCwF/c0gIJk0bX/RiKm6Ti';
const SCRIPT = readFileSync('scripts/anonymize.sql', 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');

const db = new pg.Client({ connectionString: ADMIN_URL });
await db.connect();
await ensureAppRole(db); // grants du rôle applicatif après tout --reset (comme phase50/51)
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
const TABLES = ['users','organizations','guardians','children','child_guardians','emergency_contacts','authorized_pickups','staff_profiles','conversations','messages','sessions','devices','consent_records','otp_codes','notification_queue','notification_inbox','privacy_requests','privacy_violations','media_assets','audit_logs','daily_log_events','data_access_logs','media_access_logs','outbox_events','sync_changelog','sync_operations'];
async function counts() {
  const out = {};
  for (const t of TABLES) out[t] = Number((await db.query(`SELECT count(*) n FROM ${t}`)).rows[0].n);
  return out;
}
async function scanCanary() {
  const cols = (await db.query(`SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.data_type IN ('text','character varying','jsonb')`)).rows;
  const hits = [];
  for (const c of cols) {
    const r = await db.query(`SELECT count(*) n FROM "${c.table_name}" WHERE "${c.column_name}"::text LIKE $1`, [`%${C('x').slice(0, -2)}%`]);
    if (Number(r.rows[0].n) > 0) hits.push(`${c.table_name}.${c.column_name}:${r.rows[0].n}`);
  }
  return hits;
}

// ── Fixtures : un canari par colonne couvertes (+1 résiduel hors périmètre).
const org = (await db.query('INSERT INTO organizations(slug,name_fr,wilaya,settings) VALUES($1,$2,$3,$4) RETURNING id',
  [`h2l-${TAG}`, 'Crèche Alpha 9', '31', JSON.stringify({ receipt_footer: C('settings') })])).rows[0].id;
const site = (await db.query('INSERT INTO sites(organization_id,name_fr) VALUES($1,$2) RETURNING id', [org, C('site')])).rows[0].id;
const hashReal = await bcrypt.hash('RealProdPassword!2024', 4);
const users = (await db.query(
  `INSERT INTO users(email,phone,first_name,last_name,password_hash,status,is_super_admin,totp_secret,last_login_ip) VALUES
    ($1,$2,'Sophie','Martin',$6,'active',false,NULL,'192.0.2.10'),
    ($3,$4,'Karim','Benali',$6,'active',false,$7,'192.0.2.11'),
    ($5,$8,'Platform','Admin',$6,'active',true,NULL,NULL) RETURNING id`,
  [C('staff@example.dz'), '+213555000011', C('parent@example.dz'), '+213555000022', C('admin@example.dz'), hashReal, C('totpsecret'), '+213555000033'])).rows.map(r => r.id);
const [staffUser, parentUser, adminUser] = users;
for (const [userId, slug] of [[parentUser, 'parent_primary'], [staffUser, 'educator']])
  await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3', [org, userId, slug]);
const child = (await db.query('INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,notes,special_needs_notes,photo_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
  [org, site, 'Yasmine', C('child lastname'), '2023-04-12', C('child note'), C('special needs'), 'https://cdn.example/real-photo.jpg', parentUser])).rows[0].id;
const guardian = (await db.query('INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,phone_secondary,email,national_id,address,employer,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
  [org, parentUser, C('Karim-prenom'), C('Benali-nom'), 'pere', '+213555112233', '+213555445566', C('guardian@example.dz'), '12345678901234', C('12 rue Reale Alger'), C('Employeur SA'), C('guardian notes'), parentUser])).rows[0].id;
await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_legal_guardian,is_primary) VALUES($1,$2,$3,true,true)', [org, child, guardian]);
await db.query('INSERT INTO emergency_contacts(organization_id,child_id,first_name,last_name,relationship,phone_primary) VALUES($1,$2,$3,$4,$5,$6)', [org, child, C('Amina'), C('UrgenceNom'), 'tante', '+213555778899']);
await db.query('INSERT INTO authorized_pickups(organization_id,child_id,first_name,last_name,relationship,phone,national_id,added_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [org, child, C('Mehdi'), C('PickupNom'), 'grand-frere', '+213555334455', '98765432109876', staffUser]);
await db.query('INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,national_id,cnas_number,phone,emergency_contact_name,emergency_contact_phone,notes,base_salary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [org, staffUser, 'Educatrice', '2020-01-05', C('staffnatid'), C('CNAS123'), '+213555998877', C('staff contact urgence'), '+213555110022', C('personnel notes'), 120000]);
const conv = (await db.query('INSERT INTO conversations(organization_id,child_id,subject) VALUES($1,$2,$3) RETURNING id', [org, child, C('conversation sujet')])).rows[0].id;
await db.query('INSERT INTO messages(organization_id,conversation_id,sender_id,body) VALUES($1,$2,$3,$4)', [org, conv, parentUser, C('message body avec données perso')]);
const device = (await db.query('INSERT INTO devices(organization_id,name,platform,device_fingerprint,fcm_token,apns_token,registered_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
  [org, C('iPhone de Karim'), 'ios', C('fp-abc'), C('fcm-real-token'), C('apns-real-token'), parentUser])).rows[0].id;
await db.query("INSERT INTO sessions(user_id,organization_id,refresh_token_hash,device_id,ip_address,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '7 days')",
  [parentUser, org, `REALREFRESHTOKENHASH${C('rt')}`, device, '203.0.113.7', C('Dart/3.5 ua'), ]);
await db.query("INSERT INTO consent_records(organization_id,guardian_id,child_id,consent_type,granted,ip_address,signature_data) VALUES($1,$2,$3,'photo_individual',true,$4,$5)",
  [org, guardian, child, '203.0.113.8', C('signature manuscrite')]);
await db.query("INSERT INTO otp_codes(target,code_hash,purpose,channel,expires_at) VALUES($1,'hash','whatsapp_login','whatsapp',NOW()+INTERVAL '10 minutes')", [C('parent@example.dz')]);
await db.query("INSERT INTO notification_queue(organization_id,user_id,channel,title_fr,body_fr,data,status,scheduled_at) VALUES($1,$2,'push',$3,$4,$5,'pending',NOW())",
  [org, parentUser, C('notif title'), C('notif body'), JSON.stringify({ child_name: C('notif payload name') })]);
await db.query('INSERT INTO notification_inbox(organization_id,user_id,type,title_fr,title_ar,body_fr,body_ar,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [org, parentUser, 'journal', C('inbox title'), C('inbox title ar'), C('inbox body'), C('inbox body ar'), JSON.stringify({ text: C('inbox payload') })]);
await db.query("INSERT INTO privacy_requests(organization_id,requester_id,request_type,notes,deadline) VALUES($1,$2,'export_data',$3,NOW()+INTERVAL '30 days')", [org, parentUser, C('privacy request note')]);
await db.query("INSERT INTO privacy_violations(organization_id,description,dpo_notes,notification_deadline,created_by) VALUES($1,$2,$3,NOW()+INTERVAL '24 hours',$4)",
  [org, C('violation description'), C('dpo notes'), parentUser]);
await db.query("INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,original_filename,exif_stripped,is_visible_to_parents,all_consents_checked,checksum) VALUES($1,$2,$3,'photo',$4,'image/jpeg',$5,false,true,false,'deadbeef')",
  [org, child, staffUser, `${org}/photos/opaque-uuid-key.jpg`, C('IMG_20240412_Yasmine_Benali.jpg')]);
await db.query("INSERT INTO audit_logs(organization_id,action,resource_type,resource_id,user_id,old_values,new_values,ip_address) VALUES($1,'login','user',$2,$3,$4,$5,$6)",
  [org, parentUser, parentUser, JSON.stringify({ pwd: C('audit old') }), JSON.stringify({ x: 1 }), '198.51.100.99']);
await db.query("INSERT INTO daily_log_events(organization_id,child_id,recorded_by,event_type,event_date,occurred_at,note_text,health_observation,meal_notes,activity_name,activity_notes,incident_description) VALUES($1,$2,$3,'note',CURRENT_DATE,NOW(),$4,$5,$6,$7,$8,$9)",
  [org, child, staffUser, C('journal note'), C('fièvre 39°C'), C('a mangé'), C('activité psy'), C('notes activité'), C('incident: chute')]);
await db.query('INSERT INTO data_access_logs(organization_id,user_id,device_id,data_subject_id,data_subject_type,access_type,data_type,ip_address,justification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [org, staffUser, device, parentUser, 'parent', 'view', 'health_records', '203.0.113.9', C('justification')]);
const mediaAsset = (await db.query('SELECT id FROM media_assets WHERE organization_id=$1', [org])).rows[0].id;
await db.query('INSERT INTO media_access_logs(media_id,organization_id,accessed_by,access_type,ip_address) VALUES($1,$2,$3,$4,$5)',
  [mediaAsset, org, parentUser, 'view', '203.0.113.10']);
const outbox = (await db.query('INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload) VALUES($1,$2,$3,$4) RETURNING id',
  ['children', child, 'child.created', JSON.stringify({ first_name_fr: C('outbox name'), age_months: 37, ok: true })])).rows[0].id;
await db.query('INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,sync_seq,payload) VALUES($1,$2,$3,$4,$5,$6)',
  [org, 'children', child, 'child.created', 900000000 + (process.pid % 1000), JSON.stringify({ first_name_fr: C('changelog name') })]);
await db.query("INSERT INTO sync_operations(organization_id,device_id,user_id,event_id,client_sequence,command,entity_type,payload,occurred_at_device,response_outcome,status) VALUES($1,$2,$3,$4,11,'log_note','child',$5,NOW(),$6,'accepted')",
  [org, device, parentUser, outbox, JSON.stringify({ note_text: C('sync op payload') }),
   JSON.stringify({ status: 'accepted', http_status: 201, body: { echo: C('sync outcome body') } })]);

const beforeCounts = await counts();
let app = null;

try {
  await check('canaries exist across every covered surface before anonymization', async () => {
    const hits = await scanCanary();
    assert.ok(hits.length >= 40, `expected >=40 canary columns, got ${hits.length}`);
    for (const t of ['guardians.email', 'staff_profiles.national_id', 'messages.body', 'sessions.refresh_token_hash', 'users.totp_secret', 'devices.fcm_token', 'outbox_events.payload', 'sync_operations.payload'])
      assert.ok(hits.some(h => h.startsWith(`${t}:`)), `scan must see ${t}`);
    assert.ok(hits.includes(`organizations.settings:1`), 'out-of-scope residual must be visible to the scan (not vacuous)');
  });

  await check('anonymize.sql runs as one successful transaction on a *_test database', async () => {
    await db.query(SCRIPT);
  });

  await check('no in-scope canary survives: whole-database scan only leaves the documented out-of-scope residual', async () => {
    const hits = await scanCanary();
    assert.deepEqual(hits, ['organizations.settings:1'], `unexpected residuals: ${hits.join(', ')}`);
  });

  await check('no rows were purged: no table lost a row (event triggers may legitimately append)', async () => {
    const after = await counts();
    for (const t of TABLES) assert.ok(after[t] >= beforeCounts[t], `${t} perdit des lignes: ${beforeCounts[t]} → ${after[t]}`);
    assert.equal(after.users, beforeCounts.users, 'users must never grow or shrink');
    assert.equal(after.messages, beforeCounts.messages);
  });

  await check('links survive: guardians↔children, conversations↔messages, sessions↔devices still consistent', async () => {
    const g = Number((await db.query("SELECT count(*) n FROM child_guardians cg JOIN guardians gr ON gr.id=cg.guardian_id JOIN children ch ON ch.id=cg.child_id WHERE ch.first_name_fr LIKE 'Enfant%' AND gr.last_name_fr LIKE 'Staging%'")).rows[0].n);
    assert.ok(g >= 1);
    const m = Number((await db.query("SELECT count(*) n FROM messages ms JOIN conversations cv ON cv.id=ms.conversation_id WHERE cv.subject LIKE 'Échange de test%' AND ms.body LIKE 'Message de test%'")).rows[0].n);
    assert.ok(m >= 1);
    const s = Number((await db.query("SELECT count(*) n FROM sessions se JOIN devices d ON d.id=se.device_id WHERE d.device_fingerprint LIKE 'staging-fp-%' AND se.refresh_token_hash LIKE 'staging-%'")).rows[0].n);
    assert.ok(s >= 1);
  });

  await check('deterministic identities: users email/phone rewritten from md5, national ids neutralized', async () => {
    const expectedEmail = `user+${md5(C('parent@example.dz')).slice(0, 12)}@staging.creche.dz`;
    const u = (await db.query('SELECT email,phone,totp_secret,last_login_ip FROM users WHERE id=$1', [parentUser])).rows[0];
    assert.equal(u.email, expectedEmail, 'staging email derivation must be stable and recomputable');
    assert.match(u.phone, /^\+213\d{9}$/);
    assert.equal(u.totp_secret, null);
    assert.match(u.last_login_ip, /^198\.51\.100\./);
    const sp = (await db.query('SELECT national_id,cnas_number,phone,emergency_contact_name FROM staff_profiles WHERE user_id=$1', [staffUser])).rows[0];
    assert.match(sp.national_id, /^STAG-/);
    assert.match(sp.cnas_number, /^STAG-/);
    assert.match(sp.phone, /^\+213[4-9]\d{8}$/);
    assert.match(sp.emergency_contact_name, /^Contact urgence /);
    const au = (await db.query('SELECT password_hash FROM users WHERE id=$1', [adminUser])).rows[0];
    assert.equal(au.password_hash, BCRYPT_STAGING_HASH, 'imported real bcrypt hashes must be replaced by the uniform public one');
    const gr = (await db.query('SELECT email,phone_primary,national_id,address,employer,notes FROM guardians WHERE id=$1', [guardian])).rows[0];
    assert.match(gr.email, /^guardian\+[0-9a-f]{12}@staging\.creche\.dz$/);
    assert.match(gr.phone_primary, /^\+213[4-9]\d{8}$/);
    assert.match(gr.national_id, /^STAG-/);
    assert.match(gr.address, /^Adresse staging /);
    assert.equal(gr.employer, null);
    assert.equal(gr.notes, null);
    const ec = (await db.query('SELECT first_name,last_name,phone_primary FROM emergency_contacts WHERE child_id=$1', [child])).rows[0];
    assert.match(ec.first_name, /^Urgence/);
    assert.match(ec.phone_primary, /^\+213[4-9]\d{8}$/);
    const ap = (await db.query('SELECT first_name,national_id,phone FROM authorized_pickups WHERE child_id=$1', [child])).rows[0];
    assert.match(ap.first_name, /^Autorise/);
    assert.match(ap.national_id, /^STAG-/);
  });

  await check('staging login uses the uniform public password against the real API; old password dead, MFA gone', async () => {
    const { appUrl } = await import('./helpers.mjs');
    Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true', STORAGE_BACKEND: 'local', SENTRY_DSN: '' });
    const { createApp } = await import('../../apps/api/dist/app.factory.js');
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const expectedEmail = `user+${md5(C('parent@example.dz')).slice(0, 12)}@staging.creche.dz`;
    const ok = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: expectedEmail, password: STAGING_PASSWORD }) });
    const body = await ok.text();
    assert.equal(ok.status, 200, `staging login must succeed (TOTP removed, uniform password): ${body}`);
    assert.ok(JSON.parse(body).access_token);
    const dead = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: expectedEmail, password: 'RealProdPassword!2024' }) });
    assert.equal(dead.status, 401, 'the imported real password must never authenticate staging');
  });

  await check('imported refresh token is inert after anonymization', async () => {
    const r = await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: `REALREFRESHTOKENHASH${C('rt')}` }) });
    assert.equal(r.status, 401);
  });

  await check('vendor push tokens pseudo-only; filenames rewritten; storage keys and checksum untouched', async () => {
    const d = (await db.query('SELECT fcm_token,apns_token,name FROM devices WHERE id=$1', [device])).rows[0];
    assert.match(d.fcm_token, /^staging-fcm-/);
    assert.match(d.apns_token, /^staging-apns-/);
    assert.match(d.name, /^Appareil /);
    const ma = (await db.query('SELECT original_filename,storage_key,checksum FROM media_assets WHERE child_id=$1', [child])).rows[0];
    assert.match(ma.original_filename, /^staging-[0-9a-f]{12}\.jpg$/);
    assert.ok(ma.storage_key.includes(org), 'tenant-prefixed key preserved untouched');
    assert.equal(ma.checksum, 'deadbeef');
  });

  await check('json mirrors: text leaves replaced, structure/types kept, response_outcome status kept (CHECK holds)', async () => {
    const ob = (await db.query('SELECT payload p FROM outbox_events WHERE id=$1', [outbox])).rows[0].p;
    assert.equal(ob.first_name_fr, 'staging-anon');
    assert.equal(ob.age_months, 37);
    assert.equal(ob.ok, true);
    const so = (await db.query('SELECT payload p, response_outcome ro FROM sync_operations WHERE event_id=$1', [outbox])).rows[0];
    assert.equal(so.p.note_text, 'staging-anon');
    assert.equal(so.ro.status, 'accepted', 'top-level status kept — CHECK(response_outcome->>status = status) must remain valid');
    assert.equal(so.ro.body.echo, 'staging-anon');
    assert.equal(so.ro.http_status, 201);
    const cl = (await db.query('SELECT payload p FROM sync_changelog WHERE aggregate_id=$1', [child])).rows[0].p;
    assert.equal(cl.first_name_fr, 'staging-anon');
  });

  await check('free-text business fields emptied: journal, privacy notes, dpo notes, notifications, contracts', async () => {
    const e = (await db.query('SELECT note_text,health_observation,meal_notes,activity_name,activity_notes,incident_description FROM daily_log_events WHERE child_id=$1', [child])).rows[0];
    assert.deepEqual(e, { note_text: null, health_observation: null, meal_notes: null, activity_name: null, activity_notes: null, incident_description: null });
    const pr = (await db.query('SELECT notes FROM privacy_requests WHERE requester_id=$1', [parentUser])).rows[0];
    assert.equal(pr.notes, null);
    const pv = (await db.query('SELECT description,dpo_notes FROM privacy_violations WHERE organization_id=$1', [org])).rows[0];
    assert.match(pv.description, /^Violation de test \(anonymisée\)/);
    assert.equal(pv.dpo_notes, null);
    const pq = (await db.query('SELECT title_fr,body_fr,data FROM notification_queue WHERE user_id=$1', [parentUser])).rows[0];
    assert.match(pq.title_fr, /^Notification test /);
    assert.match(pq.body_fr, /^Corps de notification anonymisé /);
    assert.equal(pq.data.child_name, 'staging-anon');
    const inb = (await db.query('SELECT body_fr,data FROM notification_inbox WHERE user_id=$1', [parentUser])).rows[0];
    assert.match(inb.body_fr, /^Corps de notification anonymisé /);
    assert.equal(inb.data.text, 'staging-anon');
  });

  await check('self-check refuses a partial script AND the transaction rolls everything back', async () => {
    const marker = SCRIPT.indexOf('-- Tuteurs légaux');
    const end = SCRIPT.indexOf('-- Enfants :');
    assert.ok(marker > 0 && end > marker, 'fixture slicing points expected');
    await db.query('UPDATE guardians SET email=$1 WHERE id=$2', [C('guardian2@example.dz'), guardian]);
    const broken = SCRIPT.slice(0, marker) + SCRIPT.slice(end);
    let rejection = null;
    try { await db.query(broken); } catch (e) { rejection = e; }
    await db.query('ROLLBACK').catch(() => undefined); // close the aborted transaction left by the script
    assert.ok(rejection, 'a script missing the guardians section must fail its own verification');
    assert.match(rejection.message, /Anonymisation incomplète — résidus: [^,]*guardians\.email/);
    const left = (await db.query('SELECT email FROM guardians WHERE id=$1', [guardian])).rows[0].email;
    assert.equal(left, C('guardian2@example.dz'), 'failed run must leave NO partial anonymization (all-or-nothing)');
    const staffHash = (await db.query('SELECT password_hash FROM users WHERE id=$1', [staffUser])).rows[0].password_hash;
    assert.equal(staffHash, BCRYPT_STAGING_HASH, 'the failed second run rolled back: earlier state (uniform hash) intact, nothing half-written');
  });

  await check('script is idempotent on re-run and re-verified', async () => {
    await db.query(SCRIPT);
    const after = await counts();
    for (const t of TABLES) assert.ok(after[t] >= beforeCounts[t], `${t} shrank on re-run`);
    const hits = await scanCanary();
    assert.deepEqual(hits, ['organizations.settings:1']);
  });

  await check('guard: execution refused on a database that does not look like staging', async () => {
    await db.query('DROP DATABASE IF EXISTS anonprod_like_h2l');
    await db.query('CREATE DATABASE anonprod_like_h2l');
    const other = new pg.Client({ connectionString: ADMIN_URL.replace(/\/creche_test\b/, '/anonprod_like_h2l') });
    await other.connect();
    try { await assert.rejects(other.query(SCRIPT), /refusé : base "anonprod_like_h2l"/); }
    finally { await other.end(); }
    await db.query('DROP DATABASE anonprod_like_h2l');
  });
} finally {
  if (app) await app.close();
  await db.end();
}
console.log(`H2l anonymization: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
