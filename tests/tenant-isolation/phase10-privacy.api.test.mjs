#!/usr/bin/env node
/**
 * Phase 10 GATE — vie privée (loi 25-11) + console support, avec deux tenants
 * A/B + super_admin, sur PostgreSQL réel avec le rôle applicatif NOBYPASSRLS.
 *
 * Cas couverts :
 *   1. parent A crée une demande d'accès pour son enfant (deadline 30 j) ;
 *   2. la directrice exporte le JSON (enfant + santé + journal + factures) ;
 *   3. B ne lit/exporte pas les demandes de A (404) ;
 *   4. un parent de B ne lit pas les demandes de A (404) ;
 *   5. résolution de la demande (directrice) ;
 *   6. violation créée avec échéance ANPDP +5 jours ; invisible pour B ;
 *   7. notification ANPDP sans SMTP → 503 VIOLATION_NOTIFY_NOT_CONFIGURED ;
 *   8. DPIA créée depuis le registre puis approuvée ;
 *   9. impersonation super_admin → token fonctionnel + audit 'impersonate' ;
 *  10. un directeur (non super_admin) → 403 sur /support/* ;
 *  11. jobs : liste + retry d'un job en échec (super_admin).
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

  const tag = `pv-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const directorRole = await db.query(`SELECT id FROM roles WHERE slug='director'`);
    const parentRole = await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`);
    // super_admin de la plateforme
    const superAdmin = await db.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, status, is_super_admin)
       VALUES ($1, 'Super', 'Admin', $2, 'active', true) RETURNING id`, [`${tag}.super@test.dz`, hash],
    );
    const mkOrg = async (slug) => {
      const org = await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [slug]);
      const site = await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org.rows[0].id]);
      const room = await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org.rows[0].id, site.rows[0].id]);
      const director = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org.rows[0].id, director.rows[0].id, directorRole.rows[0].id]);
      return { org: org.rows[0].id, site: site.rows[0].id, room: room.rows[0].id, director: director.rows[0].id };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const childA = await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'PV-A1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [A.org, A.site, A.room, A.director],
    );
    const mkParent = async (email, orgId, childId) => {
      const u = await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`, [email, hash]);
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, u.rows[0].id, parentRole.rows[0].id]);
      const g = await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`, [orgId, u.rows[0].id, A.director]);
      await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health) VALUES($1,$2,$3,true,true)`, [orgId, childId, g.rows[0].id]);
      return u.rows[0].id;
    };
    const parentA = await mkParent(`${tag}-pa@test.dz`, A.org, childA.rows[0].id);
    const parentB = await mkParent(`${tag}-pb@test.dz`, B.org, (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'PV-B1','Lina','Test','2024-01-01',$4) RETURNING id`, [B.org, B.site, B.room, B.director],
    )).rows[0].id);

    const tokenA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenPA = (await api('POST', '/auth/login', null, { email: `${tag}-pa@test.dz`, password })).body.access_token;
    const tokenPB = (await api('POST', '/auth/login', null, { email: `${tag}-pb@test.dz`, password })).body.access_token;
    const tokenSuper = (await api('POST', '/auth/login', null, { email: `${tag}.super@test.dz`, password })).body.access_token;
    ok('JWT émis (directeurs, parents, super_admin)', Boolean(tokenA && tokenB && tokenPA && tokenPB && tokenSuper));

    // Données A pour l'export : santé + journal + facture
    await api('PUT', `/health/${childA.rows[0].id}`, tokenA, { blood_type: 'O+', family_doctor: 'Dr B' });
    await api('POST', `/health/${childA.rows[0].id}/allergies`, tokenA, { allergen: 'Lait', allergen_type: 'food', severity: 'moderate' });
    await api('POST', '/journal/events', tokenA, { child_id: childA.rows[0].id, event_type: 'meal', meal_type: 'lunch', occurred_at: new Date().toISOString() });
    const contract = await api('POST', '/billing/contracts', tokenA, { child_id: childA.rows[0].id, monthly_base_amount: 10000, start_date: '2026-01-01' });
    await api('POST', '/billing/invoices/generate', tokenA, { contract_id: contract.body.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' });

    // ── 1. Demande d'accès (parent A) ───────────────────────────────────────
    console.log('\n1) Demande de droits (parent A)');
    const req = await api('POST', '/privacy/requests', tokenPA, { request_type: 'access', subject_id: childA.rows[0].id, notes: 'Export complet' });
    ok('Demande d’accès créée (pending, deadline ~30 j)', req.status === 201 && req.body.status === 'pending' && new Date(req.body.deadline).getTime() - Date.now() > 20 * 86400_000, JSON.stringify(req.body).slice(0, 140));
    const reqId = req.body.id;
    const reqList = await api('GET', '/privacy/requests', tokenA);
    ok('Directrice A : la demande est visible', reqList.status === 200 && reqList.body.length === 1 && reqList.body[0].id === reqId);

    // ── 2. Export JSON ──────────────────────────────────────────────────────
    console.log('\n2) Export JSON (droit d’accès)');
    const exportRes = await api('POST', `/privacy/requests/${reqId}/export`, tokenA, {});
    const payload = exportRes.body.payload ?? {};
    ok('Export → 200 avec payload JSON', (exportRes.status === 200 || exportRes.status === 201) && Boolean(payload.generated_at), JSON.stringify(exportRes.body).slice(0, 120));
    ok('Export : enfant + santé + journal + factures présents', payload.child?.id === childA.rows[0].id && payload.health_record?.blood_type === 'O+' && payload.allergies?.length === 1 && payload.journal_events?.length === 1 && payload.invoices?.length === 1, JSON.stringify({ child: !!payload.child, health: !!payload.health_record, allergies: payload.allergies?.length, journal: payload.journal_events?.length, invoices: payload.invoices?.length }));
    const exportPersisted = await db.query(`SELECT COUNT(*)::int AS n FROM privacy_request_exports WHERE request_id=$1`, [reqId]);
    ok('Export persisté (privacy_request_exports)', exportPersisted.rows[0].n === 1);

    // ── 3/4. Isolation B ────────────────────────────────────────────────────
    console.log('\n3-4) Isolation (org B)');
    ok('B : lecture de la demande de A → 404', (await api('GET', `/privacy/requests/${reqId}`, tokenB)).status === 404);
    ok('B : export de la demande de A → 404', (await api('POST', `/privacy/requests/${reqId}/export`, tokenB, {})).status === 404);
    ok('Parent B : lecture de la demande de A → 404', (await api('GET', `/privacy/requests/${reqId}`, tokenPB)).status === 404);
    const reqListB = await api('GET', '/privacy/requests', tokenB);
    ok('B : aucune demande de A dans sa liste', reqListB.status === 200 && reqListB.body.length === 0);

    // ── 5. Résolution ───────────────────────────────────────────────────────
    console.log('\n5) Résolution de la demande');
    const resolved = await api('POST', `/privacy/requests/${reqId}/resolve`, tokenA, {});
    ok('Résolution → status resolved', (resolved.status === 200 || resolved.status === 201) && resolved.body.status === 'resolved', JSON.stringify(resolved.body).slice(0, 100));

    // ── 6/7. Violations ─────────────────────────────────────────────────────
    console.log('\n6-7) Violations (chrono 5 jours ANPDP)');
    const violation = await api('POST', '/privacy/violations', tokenA, {
      description: 'Envoi accidentel d’une photo à un destinataire non autorisé',
      data_categories: ['photos'], affected_subjects: 1, severity: 'high',
    });
    const deadlineMs = new Date(violation.body.notification_deadline).getTime() - Date.now();
    ok('Violation créée (deadline +5 j, status open)', violation.status === 201 && violation.body.status === 'open' && deadlineMs > 4 * 86400_000 && deadlineMs < 6 * 86400_000, JSON.stringify(violation.body).slice(0, 140));
    const violId = violation.body.id;
    const violB = await api('GET', '/privacy/violations', tokenB);
    ok('B : aucune violation de A visible', violB.status === 200 && violB.body.length === 0);
    const notify = await api('POST', `/privacy/violations/${violId}/anpdp-notify`, tokenA, {});
    ok('Notification ANPDP sans SMTP → 503 VIOLATION_NOTIFY_NOT_CONFIGURED', notify.status === 503 && notify.body.code === 'VIOLATION_NOTIFY_NOT_CONFIGURED', JSON.stringify(notify.body).slice(0, 120));

    // ── 8. DPIA ─────────────────────────────────────────────────────────────
    console.log('\n8) DPIA');
    const registry = await api('GET', '/privacy/registry', tokenA);
    ok('Registre des traitements listé', registry.status === 200 && registry.body.length >= 1);
    const dpia = await api('POST', '/privacy/dpias', tokenA, {
      processing_registry_id: registry.body[0].id,
      risk_assessment: { risk_level: 'high', justification: 'photos enfants' },
      mitigation_measures: ['urls signées', 'consentements'],
    });
    ok('DPIA créée (draft)', dpia.status === 201 && dpia.body.status === 'draft', JSON.stringify(dpia.body).slice(0, 100));
    const approved = await api('POST', `/privacy/dpias/${dpia.body.id}/approve`, tokenA, {});
    ok('DPIA approuvée', (approved.status === 200 || approved.status === 201) && approved.body.status === 'approved');

    // ── 9. Impersonation (support) ──────────────────────────────────────────
    console.log('\n9) Impersonation auditée');
    const imp = await api('POST', '/support/impersonate', tokenSuper, { user_id: A.director, reason: 'Ticket support #42' });
    ok('Impersonation → token émis', (imp.status === 200 || imp.status === 201) && Boolean(imp.body.access_token), JSON.stringify(imp.body).slice(0, 100));
    const meImpersonated = await fetch(base + '/me', { headers: { authorization: `Bearer ${imp.body.access_token}` } });
    const meBody = await meImpersonated.json();
    ok('Token d’impersonation fonctionne (GET /me, org A)', meImpersonated.status === 200 && meBody.memberships?.[0]?.organization_id === A.org, JSON.stringify(meBody).slice(0, 140));
    const impAudit = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action='impersonate' AND resource_id=$1 AND new_values->>'reason'='Ticket support #42'`,
      [A.director],
    );
    ok('Impression : entrée d’audit « impersonate » avec motif', impAudit.rows[0].n === 1, `n=${impAudit.rows[0].n}`);

    // ── 10. Support restreint au super_admin ────────────────────────────────
    console.log('\n10) Support : super_admin uniquement');
    ok('Directeur B : /support/search → 403', (await api('GET', '/support/search?q=yanis', tokenB)).status === 403);
    ok('Directeur A : /support/jobs → 403', (await api('GET', '/support/jobs', tokenA)).status === 403);
    const search = await api('GET', `/support/search?q=yanis`, tokenSuper);
    ok('Super_admin : recherche globale trouve l’enfant de A', search.status === 200 && search.body.some((r) => r.kind === 'child' && r.id === childA.rows[0].id), JSON.stringify(search.body).slice(0, 200));

    // ── 11. Jobs : liste + retry ────────────────────────────────────────────
    console.log('\n11) Jobs (liste + retry)');
    const failedJob = await db.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, status, attempts, max_attempts, failure_reason, failed_at)
       VALUES ($1, 'export_report', '{}', 'failed', 3, 3, 'BOOM', NOW()) RETURNING id`,
      [A.org],
    );
    const jobs = await api('GET', '/support/jobs', tokenSuper);
    ok('Super_admin : liste des jobs (cross-tenant)', jobs.status === 200 && jobs.body.some((j) => j.id === failedJob.rows[0].id), `n=${jobs.body.length}`);
    const retry = await api('POST', `/support/jobs/${failedJob.rows[0].id}/retry`, tokenSuper, {});
    ok('Retry → status pending, attempts 0', (retry.status === 200 || retry.status === 201) && retry.body.retried === true);
    const jobState = await db.query(`SELECT status, attempts FROM background_jobs WHERE id=$1`, [failedJob.rows[0].id]);
    ok('Job relancé en base (pending, attempts=0)', jobState.rows[0].status === 'pending' && jobState.rows[0].attempts === 0, JSON.stringify(jobState.rows[0]));
  } finally {
    try {
      await db.query(`DELETE FROM privacy_request_exports WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM privacy_violations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM privacy_dpias WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM privacy_requests WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM medication_administrations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM medication_authorizations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM vaccinations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM allergies WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM health_records WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM daily_log_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM daily_summaries WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM attendance_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM attendance_sessions WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM notification_queue WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM notification_inbox WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pv-%')`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'pv-%')`);
      await db.query(`DELETE FROM child_guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM children WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM guardians WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE 'pv-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE 'pv-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'pv-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase10-privacy partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 10 vie privée : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 10 vie privée + support validée (11 cas) sur PostgreSQL réel NOBYPASSRLS.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
