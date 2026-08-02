#!/usr/bin/env node
/**
 * Phase 9 GATE — tableau de bord de la directrice + modération du journal +
 * fiche enfant enrichie, avec deux tenants A/B, sur PostgreSQL réel avec le
 * rôle applicatif NOBYPASSRLS (creche_app_test).
 *
 * Cas couverts :
 *   1. le tableau de bord de A reflète UNIQUEMENT les données de A
 *      (présences du jour par salle, non-pointés, documents expirant,
 *      factures impayées, incidents 24 h) ;
 *   2. le tableau de bord de B ne contient AUCUNE donnée de A ;
 *   3. B ne modère pas un événement de journal de A (404) ;
 *   4. la directrice de A modère un événement (visible ↔ masqué) ;
 *   5. une note privée ne devient jamais visible par les parents (422) ;
 *   6. la fiche enfant de A expose l'historique (room_moves, statuts) ;
 *   7. B ne lit pas la fiche de l'enfant de A (404).
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

  const tag = `p9-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const mkOrg = async (slug, name) => {
      const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,$2,'31') RETURNING id`, [slug, name]);
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`, 'P9A');
    const B = await mkOrg(`${tag}-b`, 'P9B');

    const mkChild = async (org, ref, first) => {
      const r = await db.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,$4,$5,'Test','2024-01-01',$6) RETURNING id`,
        [org.org, org.site, org.room, ref, first, org.director],
      );
      return r.rows[0].id;
    };
    const childA1 = await mkChild(A, 'P9-A1', 'Yanis');
    const childA2 = await mkChild(A, 'P9-A2', 'Amine');
    const childB1 = await mkChild(B, 'P9-B1', 'Lina');

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    ok('JWT directeurs A/B émis', Boolean(tokenA && tokenB));

    // Données de A : check-in enfant 1, incident, facture impayée, document expirant
    const checkIn = await api('POST', '/attendance/check-in', tokenA, { child_id: childA1 });
    ok('A : check-in enfant 1', checkIn.status === 201, JSON.stringify(checkIn.body).slice(0, 100));
    const incident = await api('POST', '/journal/events', tokenA, {
      child_id: childA2, event_type: 'incident', incident_severity: 'moderate',
      incident_description: 'Chute dans la cour', occurred_at: new Date().toISOString(),
    });
    ok('A : incident journal créé', incident.status === 201, JSON.stringify(incident.body).slice(0, 100));
    const incidentId = incident.body.id;
    const contract = await api('POST', '/billing/contracts', tokenA, {
      child_id: childA2, monthly_base_amount: 10000, start_date: '2026-01-01',
    });
    const invoice = await api('POST', '/billing/invoices/generate', tokenA, {
      contract_id: contract.body.id, period_year: 2026, period_month: 7, due_date: '2026-07-30',
    });
    ok('A : facture créée', invoice.status === 201, JSON.stringify(invoice.body).slice(0, 100));
    // Une facture 'draft' n'est pas une impayée : passage en 'sent' (envoi).
    await db.query(`UPDATE invoices SET status='sent', sent_at=NOW() WHERE id=$1`, [invoice.body.id]);
    const staffUser = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'S','T',$2,'active') RETURNING id`, [`${tag}-staff@test.dz`, hash]);
    const staffProfile = await db.query(
      `INSERT INTO staff_profiles(organization_id,user_id,qualification,hire_date,contract_type)
       VALUES($1,$2,'educator_qualified','2025-01-01','permanent') RETURNING id`,
      [A.org, staffUser.rows[0].id],
    );
    await db.query(
      `INSERT INTO staff_documents(organization_id,staff_id,document_type,title,storage_key,expiry_date)
       VALUES($1,$2,'medical','Visite médicale','p9/doc.pdf',CURRENT_DATE + 10)`,
      [A.org, staffProfile.rows[0].id],
    );

    // ── 1. Tableau de bord de A ─────────────────────────────────────────────
    console.log('\n1) Tableau de bord de A');
    const dashA = await api('GET', '/dashboard/summary', tokenA);
    ok('Dashboard A → 200', dashA.status === 200, JSON.stringify(dashA.body).slice(0, 120));
    const roomA = dashA.body.rooms?.[0];
    ok('A : salle unique avec 2 enfants (1 présent, 1 expected)', dashA.body.rooms?.length === 1 && roomA.total_children === 2 && roomA.present === 1 && roomA.expected === 1, JSON.stringify(roomA));
    const notChecked = dashA.body.alerts?.children_not_checked_in ?? [];
    ok('A : alerte « enfant non pointé » = enfant 2', notChecked.length === 1 && notChecked[0].id === childA2, JSON.stringify(notChecked));
    ok('A : alerte incident 24 h contient l’incident', (dashA.body.alerts?.recent_incidents ?? []).some((i) => i.id === incidentId));
    ok('A : alerte facture impayée contient la facture', (dashA.body.alerts?.unpaid_invoices ?? []).some((i) => i.id === invoice.body.id));
    ok('A : alerte document expirant contient le document', (dashA.body.alerts?.documents_expiring ?? []).length === 1);

    // ── 2. Tableau de bord de B : zéro donnée de A ──────────────────────────
    console.log('\n2) Tableau de bord de B (isolation)');
    const dashB = await api('GET', '/dashboard/summary', tokenB);
    ok('Dashboard B → 200', dashB.status === 200);
    const dashBJson = JSON.stringify(dashB.body);
    ok('B : aucune salle de A (ni room_id ni enfants de A)', !dashBJson.includes(A.room) && !dashBJson.includes(childA1) && !dashBJson.includes(childA2), dashBJson.slice(0, 300));
    ok('B : seule alerte = son propre enfant non pointé (aucune donnée de A)', (dashB.body.alerts?.children_not_checked_in ?? []).length === 1 && (dashB.body.alerts?.children_not_checked_in ?? [])[0].id === childB1 && (dashB.body.alerts?.documents_expiring ?? []).length === 0 && (dashB.body.alerts?.unpaid_invoices ?? []).length === 0 && (dashB.body.alerts?.recent_incidents ?? []).length === 0, JSON.stringify(dashB.body.alerts));

    // ── 3/4/5. Modération du journal ────────────────────────────────────────
    console.log('\n3-5) Modération du journal');
    const modB = await api('PATCH', `/journal/events/${incidentId}/visibility`, tokenB, { visible_to_parents: false });
    ok('B : modération d’un événement de A → 404', modB.status === 404);
    const modHide = await api('PATCH', `/journal/events/${incidentId}/visibility`, tokenA, { visible_to_parents: false });
    ok('A : masquer l’événement → 200', modHide.status === 200 && modHide.body.visible_to_parents === false, JSON.stringify(modHide.body));
    const modShow = await api('PATCH', `/journal/events/${incidentId}/visibility`, tokenA, { visible_to_parents: true });
    ok('A : réafficher l’événement → 200', modShow.status === 200 && modShow.body.visible_to_parents === true);
    const privateNote = await api('POST', '/journal/events', tokenA, {
      child_id: childA2, event_type: 'note', note_text: 'Famille à recontacter', note_is_private: true,
      occurred_at: new Date().toISOString(),
    });
    const privateNoteId = privateNote.body.id;
    const modPrivate = await api('PATCH', `/journal/events/${privateNoteId}/visibility`, tokenA, { visible_to_parents: true });
    ok('A : note privée → 422 NOTE_IS_PRIVATE', modPrivate.status === 422 && modPrivate.body.code === 'NOTE_IS_PRIVATE', JSON.stringify(modPrivate.body).slice(0, 120));
    const stillHidden = await db.query(`SELECT visible_to_parents FROM daily_log_events WHERE id=$1`, [privateNoteId]);
    ok('A : la note privée reste masquée en base', stillHidden.rows[0].visible_to_parents === false);

    // ── 6/7. Fiche enfant enrichie ──────────────────────────────────────────
    console.log('\n6-7) Fiche enfant (historique)');
    const ficheA = await api('GET', `/children/${childA1}`, tokenA);
    ok('A : fiche enfant avec historiques (room_moves, status_history)', ficheA.status === 200 && Array.isArray(ficheA.body.room_moves) && Array.isArray(ficheA.body.status_history), JSON.stringify({ rm: ficheA.body.room_moves, sh: ficheA.body.status_history }).slice(0, 120));
    const ficheB = await api('GET', `/children/${childA1}`, tokenB);
    ok('B : fiche de l’enfant de A → 404', ficheB.status === 404);
    const dashCross = await api('GET', '/dashboard/summary', tokenB);
    ok('B : aucun identifiant de A dans son dashboard', !JSON.stringify(dashCross.body).includes(childA1) && !JSON.stringify(dashCross.body).includes(childA2));
  } finally {
    // ── Nettoyage (ordre dépendant des FK) ──────────────────────────────────
    try {
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM staff_documents WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM staff_profiles WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM sync_operations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM sync_cursors WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p9-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p9-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM room_moves WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM child_status_history WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'p9-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p9-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p9-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase9 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 9 : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 9 validée : tableau de bord + modération journal + fiche enfant (7 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
