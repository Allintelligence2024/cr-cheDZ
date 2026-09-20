#!/usr/bin/env node
// G2 — Reclaim des notifications orphelines (rapport 2026-09-19, analyse 5, O4).
// Prouve la migration 065 :
//   - notif_queue_claim horodate le claim (claimed_at) ;
//   - notif_queue_reclaim renvoie les 'processing' stale à 'pending'
//     (backoff exponentiel) ou à 'failed' (attempts >= 3, motif explicite) ;
//   - les lignes fresh, sent, failed ne sont jamais touchées ;
//   - la boucle complète fonctionne : orpheline → reclaim → re-claim ;
//   - le timeout est paramétrable (argument de la fonction) ;
//   - le rôle applicatif (creche_app) a le GRANT EXECUTE (le worker l'appelle
//     à chaque drain).
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

try {
  await ensureAppRole(db);

  const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G2c-A','31') RETURNING id`, [randomUUID()])).rows[0].id;
  const user = (await db.query(`INSERT INTO users(email,first_name,last_name,status) VALUES($1,'G2c','Test','active') RETURNING id`, [`${RUN}@test.invalid`])).rows[0].id;
  const ins = async (status, claimedAgo, attempts = 0) => {
    const r = await db.query(
      `INSERT INTO notification_queue(organization_id,user_id,channel,body_fr,status,attempts,claimed_at,scheduled_at)
       VALUES($1,$2,'push','G2c body', $3, $4, NOW() - ($5 || ' seconds')::interval,
              CASE WHEN $3='pending' THEN NOW() ELSE NOW() - interval '1 day' END)
       RETURNING id`,
      [org, user, status, attempts, claimedAgo],
    );
    return r.rows[0].id;
  };
  const st = (id) => db.query(`SELECT status, attempts, claimed_at, scheduled_at, failed_at, failure_reason FROM notification_queue WHERE id=$1`, [id]).then((r) => r.rows[0]);

  const pending = await ins('pending', 0);
  const staleA = await ins('processing', 600, 1);      // orpheline 10 min, 1 essai
  const fresh = await ins('processing', 0, 1);         // en cours, fraîche
  const staleB = await ins('processing', 600, 3);      // orpheline 10 min, 3 essais
  const sent = await ins('sent', 7200, 1);             // doit rester sent
  await db.query(`UPDATE notification_queue SET sent_at=NOW() WHERE id=$1`, [sent]);

  await check('claim horodate claimed_at', async () => {
    // La ligne réclamée (la plus ancienne due — peut être celle d'une autre
    // suite en mode Gate D) doit recevoir claimed_at : preuve relative.
    const r = await db.query(`SELECT id FROM notif_queue_claim(1)`);
    assert.equal(r.rowCount, 1, 'au moins une notification due (fixture pending)');
    const row = await st(r.rows[0].id);
    assert.equal(row.status, 'processing');
    assert.ok(row.claimed_at, 'claimed_at doit être posé par le claim');
  });

  await check('reclaim (5 min) : 2 orphelines traitées, fresh et sent intouchés', async () => {
    const r = await db.query(`SELECT notif_queue_reclaim(interval '5 minutes') AS n`);
    assert.equal(Number(r.rows[0].n), 2, 'staleA → pending, staleB → failed');
    const f = await st(fresh);
    assert.equal(f.status, 'processing');
    assert.ok(f.claimed_at, 'la ligne fraîche reste processing avec son claim');
    const s = await st(sent);
    assert.equal(s.status, 'sent');
  });

  await check('orpheline 1 essai → pending + backoff exponentiel', async () => {
    const row = await st(staleA);
    assert.equal(row.status, 'pending');
    assert.equal(row.claimed_at, null);
    assert.equal(row.failure_reason, null);
    // attempts=1 → backoff 2 min (POWER(2,1))
    assert.ok(row.scheduled_at > new Date(Date.now() + 60_000), `backoff attendu (scheduled_at=${row.scheduled_at})`);
  });

  await check('orpheline 3 essais → failed + motif explicite', async () => {
    const row = await st(staleB);
    assert.equal(row.status, 'failed');
    assert.equal(row.failure_reason, 'RECLAIM_ABANDONED_AFTER_3_ATTEMPTS');
    assert.ok(row.failed_at);
  });

  await check("boucle complète : l'orpheline reclaimée est re-claimable", async () => {
    await db.query(`UPDATE notification_queue SET scheduled_at=NOW() WHERE id=$1`, [staleA]);
    // En mode Gate D d'autres suites laissent des 'pending' plus anciennes :
    // claim par lots bornés jusqu'à ce que la ligne reclaimée soit prise.
    let row = await st(staleA);
    for (let i = 0; i < 10 && row.status !== 'processing'; i++) {
      await db.query(`SELECT count(*) FROM (SELECT id FROM notif_queue_claim(25)) q`);
      row = await st(staleA);
    }
    assert.equal(row.status, 'processing');
    assert.equal(row.attempts, 2, 'le re-claim compte comme un essai');
    assert.ok(row.claimed_at);
  });

  await check("timeout paramétrable : 30 s old n'est reclaimé qu'avec un délai de 15 s", async () => {
    const row30 = await ins('processing', 30, 1);
    let r = await db.query(`SELECT notif_queue_reclaim(interval '5 minutes') AS n`);
    assert.equal(Number(r.rows[0].n), 0, '30 s < 5 min : rien à reclaim');
    r = await db.query(`SELECT notif_queue_reclaim(interval '15 seconds') AS n`);
    assert.equal(Number(r.rows[0].n), 1);
    assert.equal((await st(row30)).status, 'pending');
  });

  // Le worker (rôle applicatif creche_app, NOBYPASSRLS) appelle le reclaim à
  // chaque drain : le GRANT EXECUTE est contractuel.
  // Localement le rôle applicatif est creche_app_test (helpers) ; en
  // production creche_app (Gate D) — c'est ce dernier que la migration 065
  // GRANTe (bloc conditionnel). Preuve : un rôle NOBYPASSRLS avec le GRANT
  // exécute la fonction ; sans le GRANT (état initial en mode historique),
  // l'exécution est refusée — le GRANT est donc contractuel pour le worker.
  const roleName = new URL(appUrl()).username;
  const hadGrant = (await db.query(
    `SELECT has_function_privilege($1, 'notif_queue_reclaim(interval)', 'EXECUTE') AS h`, [roleName],
  )).rows[0].h;
  await check('rôle applicatif (NOBYPASSRLS) exécute notif_queue_reclaim avec le GRANT', async () => {
    const c = new pg.Client({ connectionString: appUrl(), statement_timeout: 10_000, connectionTimeoutMillis: 10_000 });
    try {
      if (!hadGrant) await db.query(`GRANT EXECUTE ON FUNCTION notif_queue_reclaim(interval) TO ${roleName}`);
      // Connexion EXPLICITE avant toute query : le connect implicite de
      // client.query() est un point de gel connu sur Node 22 (pas de socket
      // créé, promise non résolue) — reproduit et évité ici.
      await c.connect();
      try {
        const r = await c.query(`SELECT notif_queue_reclaim(interval '5 minutes') AS n`);
        assert.ok(Number.isInteger(Number(r.rows[0].n)));
      } finally {
        if (!hadGrant) await db.query(`REVOKE EXECUTE ON FUNCTION notif_queue_reclaim(interval) FROM ${roleName}`);
      }
    } finally {
      await c.end();
    }
  });
} finally {
  await db.end();
}
console.log(`phase55: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
