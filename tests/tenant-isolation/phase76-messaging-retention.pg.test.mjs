#!/usr/bin/env node
/**
 * L4 / décision D2 (migration 076) — rétention de la messagerie.
 *
 * Ce que la suite prouve, avec la BASE RÉELLE (PG, migrations 001→076) et le
 * rôle applicatif NOBYPASSRLS par défaut (le worker réel) :
 *
 *   1. une notification TERMINÉE (`sent`/`failed`) au-delà du seuil est purgée ;
 *   2. une notification EN COURS DE RETRY (`pending`) survit, même très
 *      ancienne — l'âge ne suffit pas, seul un statut terminal est candidat ;
 *   3. une notification `processing` (claimée par le worker) survit — le worker
 *      ne peut pas se faire retirer sous les pieds la ligne qu'il traite ;
 *   4. un message RÉCENT n'est pas touché (le contenu de la semaine reste lisible) ;
 *   5. un message ANCIEN voit son CONTENU expiré (corps remplacé par le marqueur,
 *      pièce jointe détachée) mais sa LIGNE et ses métadonnées restent : le fil
 *      ne se troue pas ;
 *   6. la fonction est IDEMPOTENTE : une seconde exécution ne « repurge » rien ;
 *   7. la purge est GLOBALE : toutes les organisations sont traitées de la même
 *      façon (rétention = obligation du responsable de traitement, pas un
 *      réglage par client) — aucune organisation n'est épargnée par accident ;
 *   8. `notification_inbox` — la voie de lecture durable — n'est pas touchée par
 *      la purge de la file opérationnelle. HORS PÉRIMÈTRE ASSUMÉ de D2 : l'inbox
 *      n'a pas de durée de conservation ; lui en donner une est une décision
 *      séparée du DPO (même patron, une ligne de plus).
 *
 * Prérequis : DATABASE_URL vers une base *_test (PG 18 réel).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (name, pass, detail) => {
  console.log(`${pass ? '✓' : '✗'} ${name}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(name);
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('L4 : base *_test uniquement');

  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', {
    cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit',
  });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);

  // Le worker réel : rôle applicatif, NOBYPASSRLS, sans contexte tenant.
  const app = new pg.Client({ connectionString: appUrl() });
  await app.connect();

  const rng = randomUUID().slice(0, 8);
  const mkOrg = async (tag) => (await admin.query(
    `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'Retention','31') RETURNING id`, [`${tag}-${rng}`],
  )).rows[0].id;

  const orgA = await mkOrg('ret-a');
  const orgB = await mkOrg('ret-b');
  const user = async (orgId, tag) => (await admin.query(
    `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T','x','active') RETURNING id`,
    [`${tag}-${rng}@test.dz`],
  )).rows[0].id;
  const userA = await user(orgA, 'ua');
  const userB = await user(orgB, 'ub');

  // Le marqueur est une CONSTANTE partagée (worker/API/tests) : on le lit à la
  // source plutôt que de le recopier — un test qui recopie ne détecte rien.
  const MARKER = (await app.query('SELECT retention_expired_body_marker() AS m')).rows[0].m;

  const queue = async (orgId, status, ageDays, label) => (await admin.query(
    `INSERT INTO notification_queue(organization_id,user_id,channel,title_fr,body_fr,status,created_at,sent_at)
     VALUES($1,$2,'push',$3,'corps',$4,$5,$6) RETURNING id`,
    [orgId, orgId === orgA ? userA : userB, label, status,
      new Date(Date.now() - ageDays * 86400_000),
      status === 'sent' ? new Date(Date.now() - ageDays * 86400_000) : null],
  )).rows[0].id;

  const convo = async (orgId, userId) => (await admin.query(
    `INSERT INTO conversations(organization_id,subject) VALUES($1,'fil') RETURNING id`, [orgId],
  )).rows[0].id;
  const message = async (orgId, convId, userId, body, ageDays) => (await admin.query(
    `INSERT INTO messages(organization_id,conversation_id,sender_id,body,sent_at)
     VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, convId, userId, body, new Date(Date.now() - ageDays * 86400_000)],
  )).rows[0].id;

  try {
    const convA = await convo(orgA, userA);
    const convB = await convo(orgB, userB);

    // ── Jeu de données : terminaux/futurs, en cours (retry), processing, voisin
    const qSentOld = await queue(orgA, 'sent', 120, 'sent-vieille');      // doit partir
    const qFailedOld = await queue(orgA, 'failed', 400, 'failed-vieille'); // doit partir
    const qSentFresh = await queue(orgA, 'sent', 2, 'sent-récente');       // doit rester
    const qPendingOld = await queue(orgA, 'pending', 900, 'pending-vieille');   // doit rester (retry)
    const qProcessingOld = await queue(orgA, 'processing', 900, 'processing-vieille'); // doit rester
    const qNeighbour = await queue(orgB, 'sent', 900, 'sent-voisine');     // doit rester (autre org)

    const mOld = await message(orgA, convA, userA, 'contenu ancien confidentiel', 500); // contenu expiré
    const mFresh = await message(orgA, convA, userA, 'contenu de la semaine', 3);       // intact
    const mNeighbour = await message(orgB, convB, userB, 'contenu voisin ancien', 500); // intact

    // L'inbox (voie durable) doit survivre à la purge de la file.
    const inbox = (await admin.query(
      `INSERT INTO notification_inbox(organization_id,user_id,type,title_fr,body_fr,created_at)
       VALUES($1,$2,'daily_report','titre','corps',$3) RETURNING id`,
      [orgA, userA, new Date(Date.now() - 900 * 86400_000)],
    )).rows[0].id;

    // ── Exécution : le chemin EXACT du worker (rôle applicatif)
    const run = async () => (await app.query(
      `SELECT notifications_purged, messages_expired FROM retention_purge_messaging(
         NOW() - ($1::int || ' days')::interval, NOW() - ($2::int || ' days')::interval)`,
      [90, 365],
    )).rows[0];

    const r1 = await run();
    ok('1. file : 3 lignes TERMINÉES purgées (2 orgA + 1 orgB, 120/400/900 j)',
      Number(r1.notifications_purged) === 3, `notifications_purged=${r1.notifications_purged}`);
    ok('5. messages : 2 contenus expirés (1 orgA + 1 orgB, 500 j)',
      Number(r1.messages_expired) === 2, `messages_expired=${r1.messages_expired}`);

    const survivors = await admin.query(
      `SELECT id, status FROM notification_queue WHERE id = ANY($1::uuid[])`,
      [[qSentFresh, qPendingOld, qProcessingOld, qNeighbour]],
    );
    const survived = new Set(survivors.rows.map((x) => x.id));
    ok('2. notification `pending` de 900 j NON purgée (retry en cours)',
      survived.has(qPendingOld), `status=${survivors.rows.find((x) => x.id === qPendingOld)?.status ?? 'SUPPRIMÉE'}`);
    ok('3. notification `processing` de 900 j NON purgée (traitement en cours)',
      survived.has(qProcessingOld));
    ok('1bis. notification `sent` de 2 j NON purgée (sous le seuil)', survived.has(qSentFresh));
    ok('7. purge GLOBALE : la ligne terminale d\'une AUTRE organisation (900 j) est purgée aussi',
      !survived.has(qNeighbour));
    const purgedGone = await admin.query(
      `SELECT count(*)::int AS n FROM notification_queue WHERE id = ANY($1::uuid[])`, [[qSentOld, qFailedOld]],
    );
    ok('1ter. les deux lignes terminales sont bien absentes',
      purgedGone.rows[0].n === 0, `restantes=${purgedGone.rows[0].n}`);

    const bodies = await admin.query(
      `SELECT id, body, attachment_id FROM messages WHERE id = ANY($1::uuid[])`,
      [[mOld, mFresh, mNeighbour]],
    );
    const bodyOf = (id) => bodies.rows.find((x) => x.id === id)?.body;
    ok('5bis. message ancien : corps remplacé par le marqueur partagé',
      bodyOf(mOld) === MARKER, `corps=${JSON.stringify(bodyOf(mOld))}`);
    ok('5ter. message ancien : la LIGNE et ses métadonnées restent (fil non troué)',
      bodies.rows.some((x) => x.id === mOld && x.attachment_id === null));
    ok('4. message récent (3 j) : contenu intact', bodyOf(mFresh) === 'contenu de la semaine',
      `corps=${JSON.stringify(bodyOf(mFresh))}`);
    ok('7bis. purge GLOBALE : le contenu ancien d\'une AUTRE organisation est expiré aussi',
      bodyOf(mNeighbour) === MARKER, `corps=${JSON.stringify(bodyOf(mNeighbour))}`);
    ok('8. notification_inbox (voie durable) intacte',
      (await admin.query('SELECT count(*)::int AS n FROM notification_inbox WHERE id=$1', [inbox])).rows[0].n === 1);

    // ── 6. Idempotence : rien de plus à purger au second passage
    const r2 = await run();
    ok('6. idempotent : second passage = 0 notification, 0 message',
      Number(r2.notifications_purged) === 0 && Number(r2.messages_expired) === 0,
      `notifications=${r2.notifications_purged} messages=${r2.messages_expired}`);

    // ── 9. Le rôle applicatif ne peut PAS faire la purge à la main (FORCE RLS
    //       sans contexte tenant) : la fonction SECURITY DEFINER est le SEUL
    //       chemin — sinon le worker purgerait des lignes sans le vouloir.
    const direct = await app.query(
      `UPDATE messages SET body = 'x' WHERE id = $1`, [mFresh],
    ).then(() => 'écriture acceptée').catch((e) => e.message);
    ok('9. hors contexte tenant, le rôle applicatif n\'écrit pas dans `messages`',
      direct !== 'écriture acceptée' || (await admin.query('SELECT body FROM messages WHERE id=$1', [mFresh])).rows[0].body === 'contenu de la semaine',
      `résultat=${direct}`);

    // ── 10. Une notification ALORS `pending` redevient purgable une fois terminée :
    //        le contrat est bien « statut terminal + âge », pas « jamais ».
    await admin.query(`UPDATE notification_queue SET status='sent', sent_at=NOW() WHERE id=$1`, [qPendingOld]);
    const r3 = await run();
    ok('10. une `pending` devenue `sent` (et ancienne) est purgée au passage suivant',
      Number(r3.notifications_purged) === 1, `notifications=${r3.notifications_purged}`);
  } finally {
    for (const org of [orgA, orgB]) {
      const scope = `(SELECT id FROM organizations WHERE id = '${org}')`;
      for (const t of ['messages', 'conversations', 'notification_queue', 'notification_inbox',
        'conversation_participants', 'notification_preferences', 'audit_logs', 'data_access_logs',
        'memberships', 'sessions']) {
        await admin.query(`DELETE FROM ${t} WHERE organization_id IN ${scope}`).catch(() => {});
      }
      await admin.query(`DELETE FROM users WHERE id IN (SELECT user_id FROM memberships WHERE organization_id IN ${scope})`).catch(() => {});
    }
    await admin.query(`DELETE FROM users WHERE email LIKE '%-${rng}@test.dz'`);
    await admin.query(`DELETE FROM organizations WHERE slug LIKE '%-${rng}'`);
    await admin.end();
    await app.end();
  }

  console.log(`\n${failures.length === 0 ? '✓' : '✗'} L4 — rétention messagerie : ${failures.length} échec(s)`);
  if (failures.length) {
    console.log(`  échecs : ${failures.join(' | ')}`);
    process.exitCode = 1;
  }
};

main().catch((e) => {
  console.error(`✗ L4 — échec inattendu : ${e.message}`);
  process.exit(1);
});
