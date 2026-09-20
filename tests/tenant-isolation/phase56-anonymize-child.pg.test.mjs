#!/usr/bin/env node
// Phase 5 (rapport 5 analyses) — C3/DB6 : effacement 25-11 par ANONYMISATION
// à chaud, par enfant (migration 067, anonymize_child).
//
// Prouve, avec le rôle applicatif (NOBYPASSRLS) sur PostgreSQL réel :
//  - refus fail-closed : sans tenant, enfant d'un autre tenant (pas d'oracle),
//    enfant encore actif, motif absent ;
//  - un enfant sorti est anonymisé en une transaction : identité, santé,
//    journal, entourage, médias (clés S3 retournées), tuteur EXCLUSIF + son
//    compte parent (sessions révoquées, token_epoch incrémenté) ;
//  - un tuteur PARTAGÉ avec une fratrie encore inscrite est CONSERVÉ ;
//  - résidus nuls : aucune valeur d'origine ne survit dans les tables couvertes ;
//  - factures/paiements conservés (obligation comptable), audit écrit,
//    tombstone de sync émis ; rejeu idempotent (aucun nouvel écrit).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureAppRole, appUrl } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.message}`); } };
const RUN = randomUUID().slice(0, 8);

const appClient = async () => { const c = new pg.Client({ connectionString: appUrl() }); await c.connect(); return c; };
async function committed(tenant, fn) {
  const c = await appClient();
  try { await c.query('BEGIN'); if (tenant) await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]); return await fn(c); }
  finally { await c.query('COMMIT'); await c.end(); }
}
async function scoped(tenant, fn) {
  const c = await appClient();
  try { await c.query('BEGIN'); if (tenant) await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]); return await fn(c); }
  finally { await c.query('ROLLBACK'); await c.end(); }
}
const expectReject = async (fn, needle) => {
  try { await fn(); } catch (e) {
    if (e.message.includes(needle) || e.code === needle) return;
    throw new Error(`refus attendu ${needle}, reçu ${e.code} (${e.message})`);
  }
  throw new Error(`refus attendu (${needle}) — l'opération a réussi`);
};

// Canaris : valeurs uniques à ce run, cherchées ensuite dans toute la base.
const K = {
  childFirst: `Canari-${RUN}-enfant`, childLast: `Famille-${RUN}`,
  gFirst: `Canari-${RUN}-tuteur`, gPhone: `+2135${RUN.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
  gEmail: `canari-${RUN}@parent.invalid`, gNid: `NID-${RUN}`, gAddr: `Rue canari ${RUN}`,
  uEmail: `user-${RUN}@parent.invalid`, uPhone: `+2136${RUN.replace(/\D/g, '').padEnd(8, '2').slice(0, 8)}`,
  doctor: `Dr Canari ${RUN}`, allergen: `Arachide-${RUN}`, note: `Note privée ${RUN}`,
  ecName: `Urgence-${RUN}`, apName: `Pickup-${RUN}`, msg: `Message canari ${RUN}`,
  filename: `photo-${RUN}.jpg`, sharedFirst: `Partage-${RUN}-tuteur`,
};

const ids = {};
try {
  await ensureAppRole(db);

  // ── Fixtures : org A (cible) et org B (isolation) ─────────────────────────
  await committed(null, async (c) => {
    ids.orgA = (await c.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P56-A','31') RETURNING id`, [randomUUID()])).rows[0].id;
    ids.orgB = (await c.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P56-B','16') RETURNING id`, [randomUUID()])).rows[0].id;
    ids.actor = (await c.query(`INSERT INTO users(email,first_name,last_name,status) VALUES($1,'Dir','P56','active') RETURNING id`, [`dir-${RUN}@test.invalid`])).rows[0].id;
    ids.parentUser = (await c.query(`INSERT INTO users(email,phone,first_name,last_name,status,password_hash,totp_secret,totp_enabled)
      VALUES($1,$2,'ParentCanari','P56','active','$2b$10$abcdefghijklmnopqrstuv','JBSWY3DPEHPK3PXP',true) RETURNING id, token_epoch`, [K.uEmail, K.uPhone])).rows[0];
    ids.sharedUser = (await c.query(`INSERT INTO users(email,first_name,last_name,status) VALUES($1,'ParentPartage','P56','active') RETURNING id`, [`shared-${RUN}@parent.invalid`])).rows[0].id;
    ids.session = (await c.query(`INSERT INTO sessions(user_id,organization_id,refresh_token_hash,expires_at) VALUES($1,$2,$3,NOW()+interval '1 day') RETURNING id`,
      [ids.parentUser.id, ids.orgA, `h-${RUN}`])).rows[0].id;
  });
  await committed(ids.orgA, async (c) => {
    ids.site = (await c.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'P56 Site') RETURNING id`, [ids.orgA])).rows[0].id;
    // Enfant sortant (departed) + fratrie encore active
    ids.child = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,gender,notes,status,departure_date,created_by)
      VALUES($1,$2,$3,$4,'2021-05-17','F',$5,'departed','2026-08-31',$6) RETURNING id`, [ids.orgA, ids.site, K.childFirst, K.childLast, K.note, ids.actor])).rows[0].id;
    ids.sibling = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,status,created_by)
      VALUES($1,$2,'Frere','P56','2023-02-01','active',$3) RETURNING id`, [ids.orgA, ids.site, ids.actor])).rows[0].id;
    ids.activeChild = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,status,created_by)
      VALUES($1,$2,'Actif','P56','2022-01-01','active',$3) RETURNING id`, [ids.orgA, ids.site, ids.actor])).rows[0].id;
    // Tuteur EXCLUSIF (compte parent) et tuteur PARTAGÉ (fratrie)
    ids.guardian = (await c.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,email,national_id,address,employer,created_by)
      VALUES($1,$2,$3,$4,'mother',$5,$6,$7,$8,'Employeur canari',$9) RETURNING id`, [ids.orgA, ids.parentUser.id, K.gFirst, K.childLast, K.gPhone, K.gEmail, K.gNid, K.gAddr, ids.actor])).rows[0].id;
    ids.shared = (await c.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by)
      VALUES($1,$2,$3,$4,'father','+213700000000',$5) RETURNING id`, [ids.orgA, ids.sharedUser, K.sharedFirst, K.childLast, ids.actor])).rows[0].id;
    for (const [g, ch] of [[ids.guardian, ids.child], [ids.shared, ids.child], [ids.shared, ids.sibling]]) {
      await c.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_legal_guardian,is_primary) VALUES($1,$2,$3,true,true)`, [ids.orgA, ch, g]);
    }
    await c.query(`INSERT INTO health_records(organization_id,child_id,blood_type,family_doctor,doctor_phone,chronic_conditions) VALUES($1,$2,'A+',$3,'+213555000000','Asthme')`, [ids.orgA, ids.child, K.doctor]);
    await c.query(`INSERT INTO allergies(organization_id,child_id,allergen,allergen_type,severity,reaction,created_by) VALUES($1,$2,$3,'food','severe','Urticaire',$4)`, [ids.orgA, ids.child, K.allergen, ids.actor]);
    await c.query(`INSERT INTO daily_log_events(organization_id,child_id,event_date,event_type,occurred_at,recorded_by,note_text) VALUES($1,$2,CURRENT_DATE,'note',NOW(),$3,$4)`, [ids.orgA, ids.child, ids.actor, K.note]);
    await c.query(`INSERT INTO emergency_contacts(organization_id,child_id,first_name,last_name,relationship,phone_primary) VALUES($1,$2,$3,'P56','aunt','+213661000000')`, [ids.orgA, ids.child, K.ecName]);
    await c.query(`INSERT INTO authorized_pickups(organization_id,child_id,first_name,last_name,relationship,phone,added_by) VALUES($1,$2,$3,'P56','uncle','+213662000000',$4)`, [ids.orgA, ids.child, K.apName, ids.actor]);
    ids.conv = (await c.query(`INSERT INTO conversations(organization_id,child_id,subject) VALUES($1,$2,'Sujet canari') RETURNING id`, [ids.orgA, ids.child])).rows[0].id;
    await c.query(`INSERT INTO messages(organization_id,conversation_id,sender_id,body) VALUES($1,$2,$3,$4)`, [ids.orgA, ids.conv, ids.actor, K.msg]);
    ids.media = (await c.query(`INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,original_filename,checksum)
      VALUES($1,$2,$3,'photo',$4,'image/jpeg',$5,'deadbeef') RETURNING id, storage_key`, [ids.orgA, ids.child, ids.actor, `${ids.orgA}/photo/${RUN}-a.jpg`, K.filename])).rows[0];
    ids.groupMedia = (await c.query(`INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,children_in_photo)
      VALUES($1,$2,$3,'photo',$4,'image/jpeg',ARRAY[$2,$5]::uuid[]) RETURNING id, storage_key`, [ids.orgA, ids.sibling, ids.actor, `${ids.orgA}/photo/${RUN}-group.jpg`, ids.child])).rows[0];
    await c.query(`INSERT INTO consent_records(organization_id,guardian_id,child_id,consent_type,granted,granted_at,ip_address,signature_data,collected_by,collection_method)
      VALUES($1,$2,$3,'photo_individual',true,NOW(),'203.0.113.9','sig-canari',$4,'app')`, [ids.orgA, ids.guardian, ids.child, ids.actor]);
    // Comptabilité : facture payée (doit SURVIVRE)
    ids.inv = (await c.query(`INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,paid_amount,due_date,status,created_by)
      VALUES($1,$2,$3,2026,6,5000,5000,5000,'2026-07-10','paid',$4) RETURNING id`, [ids.orgA, `P56-${RUN}`, ids.child, ids.actor])).rows[0].id;
    ids.pay = (await c.query(`INSERT INTO payments(organization_id,reference_number,receipt_number,child_id,site_id,amount,method,status,received_at,confirmed_at,created_by)
      VALUES($1,$2,$3,$4,$5,5000,'cash','confirmed',NOW(),NOW(),$6) RETURNING id`, [ids.orgA, `P56P-${RUN}`, `REC-${RUN}`, ids.child, ids.site, ids.actor])).rows[0].id;
    ids.syncBefore = (await c.query(`SELECT COALESCE(max(sync_seq),0) s FROM sync_changelog WHERE organization_id=$1 AND aggregate_id=$2`, [ids.orgA, ids.child])).rows[0].s;
  });

  // ── Refus fail-closed ─────────────────────────────────────────────────────
  await check('sans contexte tenant → TENANT_CONTEXT_REQUIRED', () =>
    scoped(null, (c) => expectReject(() => c.query(`SELECT anonymize_child($1,$2,'départ définitif')`, [ids.child, ids.actor]), 'TENANT_CONTEXT_REQUIRED')));
  await check('enfant d’un autre tenant → CHILD_NOT_FOUND (pas d’oracle d’existence)', () =>
    scoped(ids.orgB, (c) => expectReject(() => c.query(`SELECT anonymize_child($1,$2,'départ définitif')`, [ids.child, ids.actor]), 'CHILD_NOT_FOUND')));
  await check('enfant encore actif → CHILD_STILL_ACTIVE (jamais d’effacement d’un dossier en cours)', () =>
    scoped(ids.orgA, (c) => expectReject(() => c.query(`SELECT anonymize_child($1,$2,'départ définitif')`, [ids.activeChild, ids.actor]), 'CHILD_STILL_ACTIVE')));
  await check('motif absent/trop court → ANONYMIZE_REASON_REQUIRED', () =>
    scoped(ids.orgA, (c) => expectReject(() => c.query(`SELECT anonymize_child($1,$2,'ok')`, [ids.child, ids.actor]), 'ANONYMIZE_REASON_REQUIRED')));
  await check('acteur absent → ANONYMIZE_ACTOR_REQUIRED', () =>
    scoped(ids.orgA, (c) => expectReject(() => c.query(`SELECT anonymize_child($1,NULL,'départ définitif')`, [ids.child]), 'ANONYMIZE_ACTOR_REQUIRED')));
  await check('un refus n’écrit rien (enfant intact)', async () => {
    const r = await scoped(ids.orgA, (c) => c.query(`SELECT first_name_fr FROM children WHERE id=$1`, [ids.child]));
    assert.equal(r.rows[0].first_name_fr, K.childFirst);
  });

  // ── Anonymisation effective ───────────────────────────────────────────────
  let result;
  await check('anonymize_child (rôle app, tenant A) → résultat structuré', async () => {
    result = await committed(ids.orgA, async (c) => (await c.query(`SELECT anonymize_child($1,$2,$3) r`, [ids.child, ids.actor, 'Demande d’effacement du tuteur (25-11) après départ'])).rows[0].r);
    assert.equal(result.already_anonymized, false);
    assert.deepEqual(result.guardian_ids, [ids.guardian], 'seul le tuteur EXCLUSIF est ciblé');
    assert.deepEqual(result.user_ids, [ids.parentUser.id]);
    assert.deepEqual([...result.media_storage_keys].sort(), [ids.media.storage_key, ids.groupMedia.storage_key].sort(), 'clés S3 à purger retournées (photo directe + photo de groupe)');
    assert.equal(result.counts.health_records, 1);
    assert.equal(result.counts.guardians, 1);
  });

  await check('enfant : identité effacée, DOB réduite au mois, statut departed + deleted_at', async () => {
    const r = (await db.query(`SELECT * FROM children WHERE id=$1`, [ids.child])).rows[0];
    assert.match(r.first_name_fr, /^Anonyme-[0-9a-f]{8}$/);
    assert.equal(r.last_name_fr, 'Anonyme');
    assert.equal(r.notes, null); assert.equal(r.gender, null); assert.equal(r.photo_url, null);
    assert.equal(new Date(r.date_of_birth).getUTCDate(), 1);
    assert.equal(r.status, 'departed'); assert.ok(r.deleted_at); assert.equal(r.departure_reason, 'ANONYMIZED');
  });

  await check('tuteur exclusif + compte parent anonymisés ; sessions révoquées ; token_epoch incrémenté (G4)', async () => {
    const g = (await db.query(`SELECT * FROM guardians WHERE id=$1`, [ids.guardian])).rows[0];
    assert.equal(g.email, null); assert.equal(g.phone_primary, null); assert.equal(g.national_id, null); assert.equal(g.address, null); assert.ok(g.deleted_at);
    const u = (await db.query(`SELECT * FROM users WHERE id=$1`, [ids.parentUser.id])).rows[0];
    assert.match(u.email, /@anonymise\.invalid$/); assert.equal(u.phone, null); assert.equal(u.password_hash, null);
    assert.equal(u.totp_secret, null); assert.equal(u.totp_enabled, false); assert.equal(u.status, 'deleted');
    assert.ok(Number(u.token_epoch) > Number(ids.parentUser.token_epoch), 'token_epoch incrémenté → jetons existants invalidés');
    const s = (await db.query(`SELECT revoked_at, revoked_reason FROM sessions WHERE id=$1`, [ids.session])).rows[0];
    assert.ok(s.revoked_at); assert.equal(s.revoked_reason, 'ANONYMIZED');
  });

  await check('tuteur PARTAGÉ (fratrie active) et son compte CONSERVÉS intacts', async () => {
    const g = (await db.query(`SELECT first_name_fr, deleted_at FROM guardians WHERE id=$1`, [ids.shared])).rows[0];
    assert.equal(g.first_name_fr, K.sharedFirst); assert.equal(g.deleted_at, null);
    const u = (await db.query(`SELECT status, deleted_at FROM users WHERE id=$1`, [ids.sharedUser])).rows[0];
    assert.equal(u.status, 'active'); assert.equal(u.deleted_at, null);
    const sib = (await db.query(`SELECT first_name_fr, status FROM children WHERE id=$1`, [ids.sibling])).rows[0];
    assert.equal(sib.first_name_fr, 'Frere'); assert.equal(sib.status, 'active');
  });

  await check('santé, journal, entourage, messagerie, médias : neutralisés', async () => {
    const h = (await db.query(`SELECT family_doctor, chronic_conditions, blood_type FROM health_records WHERE child_id=$1`, [ids.child])).rows[0];
    assert.deepEqual([h.family_doctor, h.chronic_conditions, h.blood_type], [null, null, null]);
    const a = (await db.query(`SELECT allergen, reaction, is_active FROM allergies WHERE child_id=$1`, [ids.child])).rows[0];
    assert.equal(a.allergen, 'anonymisé'); assert.equal(a.reaction, null); assert.equal(a.is_active, false);
    assert.equal((await db.query(`SELECT note_text FROM daily_log_events WHERE child_id=$1`, [ids.child])).rows[0].note_text, null);
    assert.equal((await db.query(`SELECT first_name FROM emergency_contacts WHERE child_id=$1`, [ids.child])).rows[0].first_name, 'Anonyme');
    const ap = (await db.query(`SELECT first_name, is_active FROM authorized_pickups WHERE child_id=$1`, [ids.child])).rows[0];
    assert.equal(ap.first_name, 'Anonyme'); assert.equal(ap.is_active, false);
    const m = (await db.query(`SELECT body, deleted_at FROM messages WHERE conversation_id=$1`, [ids.conv])).rows[0];
    assert.equal(m.body, 'anonymisé'); assert.ok(m.deleted_at);
    const med = (await db.query(`SELECT original_filename, checksum, deleted_at, is_visible_to_parents FROM media_assets WHERE id=$1`, [ids.media.id])).rows[0];
    assert.deepEqual([med.original_filename, med.checksum, med.is_visible_to_parents], [null, null, false]); assert.ok(med.deleted_at);
    assert.ok((await db.query(`SELECT deleted_at FROM media_assets WHERE id=$1`, [ids.groupMedia.id])).rows[0].deleted_at, 'photo de groupe masquée aussi');
    const cr = (await db.query(`SELECT ip_address, signature_data, granted FROM consent_records WHERE child_id=$1`, [ids.child])).rows[0];
    assert.deepEqual([cr.ip_address, cr.signature_data, cr.granted], [null, null, true], 'preuve de consentement conservée, empreinte/signature effacées');
  });

  await check('résidus NULS : aucun canari ne survit dans les tables couvertes', async () => {
    const tables = ['children', 'guardians', 'users', 'health_records', 'allergies', 'daily_log_events', 'emergency_contacts',
      'authorized_pickups', 'messages', 'conversations', 'media_assets', 'consent_records', 'sessions', 'notification_inbox'];
    const canaries = [K.childFirst, K.childLast, K.gFirst, K.gPhone, K.gEmail, K.gNid, K.gAddr, K.uEmail, K.uPhone, K.doctor, K.allergen, K.note, K.ecName, K.apName, K.msg, K.filename];
    for (const t of tables) {
      const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type IN ('text','character varying','inet','jsonb')`, [t])).rows.map((r) => r.column_name);
      if (!cols.length) continue;
      const expr = cols.map((c) => `COALESCE("${c}"::text,'')`).join(" || ' ' || ");
      // Exclut le tuteur partagé (last_name volontairement conservé) et le canari de la fratrie.
      const excl = t === 'guardians' ? ` AND id <> '${ids.shared}'` : t === 'children' ? ` AND id <> '${ids.sibling}'` : '';
      for (const k of canaries) {
        const n = (await db.query(`SELECT count(*)::int n FROM "${t}" WHERE (${expr}) LIKE '%' || $1 || '%'${excl}`, [k])).rows[0].n;
        assert.equal(n, 0, `résidu « ${k} » dans ${t}`);
      }
    }
  });

  await check('comptabilité CONSERVÉE : facture payée + paiement confirmé intacts (FK RESTRICT respectées)', async () => {
    const inv = (await db.query(`SELECT status, total_amount, child_id FROM invoices WHERE id=$1`, [ids.inv])).rows[0];
    assert.equal(inv.status, 'paid'); assert.equal(Number(inv.total_amount), 5000); assert.equal(inv.child_id, ids.child);
    const p = (await db.query(`SELECT status, amount FROM payments WHERE id=$1`, [ids.pay])).rows[0];
    assert.equal(p.status, 'confirmed'); assert.equal(Number(p.amount), 5000);
  });

  await check('audit écrit (delete/child, motif, compteurs) sans donnée personnelle', async () => {
    const a = (await db.query(`SELECT * FROM audit_logs WHERE resource_type='child' AND resource_id=$1 AND action='delete' ORDER BY occurred_at DESC LIMIT 1`, [ids.child])).rows[0];
    assert.ok(a, 'ligne d’audit');
    assert.equal(a.user_id, ids.actor);
    assert.equal(a.new_values.anonymized, true);
    assert.match(a.new_values.reason, /25-11/);
    assert.equal(a.new_values.guardians, 1);
    assert.ok(!JSON.stringify(a).includes(K.childFirst) && !JSON.stringify(a).includes(K.gEmail));
  });

  await check('tombstone de sync émis (trigger 059 : event_type deleted, payload sans identité)', async () => {
    const r = (await db.query(`SELECT event_type, payload FROM sync_changelog WHERE organization_id=$1 AND aggregate_type='child' AND aggregate_id=$2 AND sync_seq > $3 ORDER BY sync_seq DESC LIMIT 1`, [ids.orgA, ids.child, ids.syncBefore])).rows[0];
    assert.ok(r, 'entrée de changelog');
    assert.equal(r.event_type, 'deleted');
    assert.equal(r.payload.first_name_fr, undefined);
  });

  await check('rejeu idempotent : already_anonymized=true, aucun nouvel audit, version inchangée', async () => {
    const before = (await db.query(`SELECT version FROM children WHERE id=$1`, [ids.child])).rows[0].version;
    const audits = (await db.query(`SELECT count(*)::int n FROM audit_logs WHERE resource_type='child' AND resource_id=$1 AND action='delete'`, [ids.child])).rows[0].n;
    const r = await committed(ids.orgA, async (c) => (await c.query(`SELECT anonymize_child($1,$2,'rejeu de contrôle') r`, [ids.child, ids.actor])).rows[0].r);
    assert.equal(r.already_anonymized, true);
    assert.equal((await db.query(`SELECT version FROM children WHERE id=$1`, [ids.child])).rows[0].version, before);
    assert.equal((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE resource_type='child' AND resource_id=$1 AND action='delete'`, [ids.child])).rows[0].n, audits);
  });

  await check('DB6 : la suppression physique reste impossible par conception (FK RESTRICT)', () =>
    scoped(ids.orgA, (c) => expectReject(() => c.query(`DELETE FROM children WHERE id=$1`, [ids.child]), '23503')));
} finally {
  await db.end();
}
console.log(`\nPhase 56 anonymize_child : ${passed} ✓ / ${failed} ✗`);
if (failed > 0) { console.error('ÉCHEC Phase 56 anonymize_child'); process.exit(1); }
console.log('✓ Phase 56 anonymize_child validée (25-11 : effacement par anonymisation à chaud, par enfant, transactionnel, idempotent, audité) sur PostgreSQL réel NOBYPASSRLS.');
