#!/usr/bin/env node
/**
 * P1-3 (piliers manquants) — test de CHARGE/CAPACITÉ reproductible, sans k6.
 *
 * Mesures RÉELLES : API compilée (apps/api/dist) + PostgreSQL réel, rôle
 * applicatif NOBYPASSRLS, pool de 10 connexions (config de prod). Node pur
 * (fetch concurrent) : exécutable dans la sandbox ET en CI, contrairement à
 * `sync.k6.js` (jamais exécuté faute de k6).
 *
 * Scénario (« matin de rentrée » sur ORGS structures en parallèle) :
 *   1. logins concurrents (ORGS × 2 directeurs)             — bcrypt = CPU
 *   2. pointage : check-in de CHILDREN enfants par structure  — écritures RLS
 *   3. sync push : DEVICES tablettes × OPS opérations offline — batch + triggers
 *   4. lecture : fil du jour + tableau de bord, concurrents   — lectures agrégées
 *   5. rafale mixte : tout en même temps pendant BURST_ROUNDS tours
 *
 * Budgets (p95, ms) — volontairement PROCHES des mesures actuelles pour
 * servir de cliquet anti-régression, pas de vitrine :
 *   login 1500 · check-in 250 · sync push (20 ops) 1500 · feed 300 · dashboard 400
 *   et 0 réponse 5xx sur l'ensemble.
 *
 * Usage : DATABASE_URL=postgres://…/creche_test node tests/load/capacity-bench.mjs
 *   ORGS=12 CHILDREN=15 DEVICES=2 OPS=20 BURST_ROUNDS=3 (défauts CI raisonnables)
 *   Le rapport JSON est écrit dans tests/load/capacity-report.json (ignoré par git).
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from '../tenant-isolation/helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = (k, d) => Number(process.env[k] ?? d);
const ORGS = env('ORGS', 12), CHILDREN = env('CHILDREN', 15), DEVICES = env('DEVICES', 2), OPS = env('OPS', 20), BURST_ROUNDS = env('BURST_ROUNDS', 3);
// Budgets = cliquet anti-régression calibré sur la mesure du 2026-09-20 (2 vCPU, PG local, bcrypt cost 12),
// pas des objectifs produit. login : 24 comparaisons bcrypt concurrentes ≈ 2,3 s sur 2 vCPU (CPU-bound,
// voir docs/ANALYSE_PILIERS_MANQUANTS.md § P1-3). Toute hausse > ~25 % fait échouer le bench.
const BUDGET_P95 = { login: 3000, checkin: 250, sync_push: 3000, feed: 1500, dashboard: 1500 };

const samples = {}; // label -> [ms]
let http5xx = 0, httpOther = 0;
const record = (label, ms) => { (samples[label] ??= []).push(ms); };
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (label) => { const a = samples[label] ?? []; return { n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: Math.max(0, ...a) }; };

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis');
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('capacity-bench : base *_test uniquement');
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  Object.assign(process.env, { DATABASE_URL: appUrl(), RATE_LIMIT_DISABLED: 'true', NODE_ENV: 'test', SENTRY_DSN: '' });
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (label, method, path, token, body) => {
    const t0 = performance.now();
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const ms = performance.now() - t0;
    record(label, ms);
    if (r.status >= 500) http5xx += 1;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, body: json, ms };
  };

  const tag = `cap-${randomUUID().slice(0, 6)}`;
  const password = 'Capacity123!';
  const hash = await bcrypt.hash(password, 10);
  const orgs = [];
  const t0 = Date.now();
  try {
    // ── Fixtures : ORGS structures, 2 directeurs, CHILDREN enfants, DEVICES tablettes chacune
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    for (let o = 0; o < ORGS; o += 1) {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'Capacité','31') RETURNING id`, [`${tag}-${o}`])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',30) RETURNING id`, [org, site])).rows[0].id;
      const users = [];
      for (let u = 0; u < 2; u += 1) {
        const email = `${tag}-${o}-${u}@test.dz`;
        const id = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','Cap',$2,'active') RETURNING id`, [email, hash])).rows[0].id;
        await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, id, directorRole]);
        users.push({ id, email });
      }
      const children = [];
      for (let c = 0; c < CHILDREN; c += 1) {
        children.push((await db.query(`INSERT INTO children(organization_id,site_id,room_id,first_name_fr,last_name_fr,date_of_birth,status,created_by)
          VALUES($1,$2,$3,$4,'Cap','2023-03-01','active',$5) RETURNING id`, [org, site, room, `E${c}`, users[0].id])).rows[0].id);
      }
      orgs.push({ org, site, room, users, children, devices: [] });
    }

    // ── 1. Logins concurrents
    console.log(`\n1) ${ORGS * 2} logins concurrents`);
    await Promise.all(orgs.flatMap((o) => o.users.map(async (u) => {
      const r = await api('login', 'POST', '/auth/login', null, { email: u.email, password });
      if (r.status !== 200) { httpOther += 1; throw new Error(`login ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`); }
      u.token = r.body.access_token;
    })));
    for (const o of orgs) {
      for (let d = 0; d < DEVICES; d += 1) {
        const r = await api('device', 'POST', '/devices', o.users[0].token, { name: `T${d}`, device_fingerprint: `${tag}-${o.org}-${d}`, platform: 'android' });
        if (r.status !== 201) throw new Error(`device ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
        o.devices.push(r.body.device_id);
      }
    }

    // ── 2. Pointage concurrent : toutes les structures en même temps
    console.log(`2) pointage ${ORGS} × ${CHILDREN} check-ins (structures en parallèle)`);
    await Promise.all(orgs.map(async (o) => {
      for (const cid of o.children) {
        const r = await api('checkin', 'POST', '/attendance/check-in', o.users[0].token, { child_id: cid });
        if (r.status !== 201) httpOther += 1;
      }
    }));

    // ── 3. Sync push concurrent : DEVICES tablettes par structure, OPS opérations chacune
    console.log(`3) sync push ${ORGS} × ${DEVICES} tablettes × ${OPS} opérations`);
    let seq = 0;
    const pushOnce = async (o, device, round) => {
      const ops = Array.from({ length: OPS }, (_, i) => {
        const child_id = o.children[(i + round) % o.children.length];
        const kind = i % 3;
        return {
          event_id: randomUUID(), client_sequence: ++seq, schema_version: 1,
          command: kind === 0 ? 'log_meal' : kind === 1 ? 'log_diaper' : 'log_temperature', entity_type: 'daily_log',
          payload: kind === 0 ? { child_id, meal_type: 'snack', meal_quantity: 'good' } : kind === 1 ? { child_id, diaper_type: 'wet' } : { child_id, temperature_celsius: 36.7 },
          occurred_at_device: new Date().toISOString(),
        };
      });
      const r = await api('sync_push', 'POST', '/sync/push', o.users[0].token, { device_id: device, operations: ops });
      if (r.status !== 200 || (r.body.accepted?.length ?? 0) !== OPS) { httpOther += 1; if (process.env.DEBUG) console.error('push', r.status, JSON.stringify(r.body).slice(0, 300)); }
      return r;
    };
    await Promise.all(orgs.flatMap((o) => o.devices.map((d) => pushOnce(o, d, 0))));

    // ── 4. Lectures concurrentes
    console.log(`4) lectures : fil du jour + tableau de bord × ${ORGS}`);
    await Promise.all(orgs.flatMap((o) => [
      api('feed', 'GET', `/journal/feed?child_id=${o.children[0]}`, o.users[0].token).then((r) => { if (r.status !== 200) { httpOther += 1; if (process.env.DEBUG) console.error('feed', r.status, JSON.stringify(r.body).slice(0, 200)); } }),
      api('dashboard', 'GET', '/dashboard/summary', o.users[1].token).then((r) => { if (r.status !== 200) { httpOther += 1; if (process.env.DEBUG) console.error('dashboard', r.status, JSON.stringify(r.body).slice(0, 200)); } }),
    ]));

    // ── 5. Rafale mixte
    console.log(`5) rafale mixte × ${BURST_ROUNDS} tours (login + push + feed + dashboard, toutes structures)`);
    for (let round = 1; round <= BURST_ROUNDS; round += 1) {
      await Promise.all(orgs.flatMap((o) => [
        ...(process.env.NO_BURST_LOGIN ? [] : [api('login', 'POST', '/auth/login', null, { email: o.users[0].email, password })]),
        ...o.devices.map((d) => pushOnce(o, d, round)),
        api('feed', 'GET', `/journal/feed?child_id=${o.children[0]}`, o.users[0].token),
        api('dashboard', 'GET', '/dashboard/summary', o.users[1].token),
      ]));
    }

    // ── Rapport
    const total = Object.values(samples).reduce((n, a) => n + a.length, 0);
    const wall = (Date.now() - t0) / 1000;
    const report = { orgs: ORGS, children: CHILDREN, devices: DEVICES, ops: OPS, burst_rounds: BURST_ROUNDS, requests: total, wall_seconds: Number(wall.toFixed(1)), http5xx, http_unexpected: httpOther, budgets_p95_ms: BUDGET_P95, results: {} };
    let ok = true;
    console.log(`\n${total} requêtes en ${wall.toFixed(1)} s — 5xx: ${http5xx}, réponses inattendues: ${httpOther}`);
    console.log('label        n     p50     p95     p99     max   budget p95');
    for (const [label, budget] of Object.entries(BUDGET_P95)) {
      const s = stats(label);
      const within = s.p95 <= budget;
      ok &&= within;
      report.results[label] = { ...s, budget_p95: budget, ok: within };
      console.log(`${within ? '✓' : '✗'} ${label.padEnd(10)} ${String(s.n).padStart(4)} ${s.p50.toFixed(0).padStart(7)} ${s.p95.toFixed(0).padStart(7)} ${s.p99.toFixed(0).padStart(7)} ${s.max.toFixed(0).padStart(7)}   ${budget}`);
    }
    if (http5xx > 0 || httpOther > 0) ok = false;
    // Sanity : les écritures sync ont bien atterri (pas seulement des 200 rapides).
    const landed = (await db.query(`SELECT count(*)::int n FROM daily_log_events WHERE organization_id = ANY($1::uuid[])`, [orgs.map((o) => o.org)])).rows[0].n;
    const expected = ORGS * DEVICES * OPS * (1 + BURST_ROUNDS);
    console.log(`${landed === expected ? '✓' : '✗'} événements de journal persistés : ${landed} / ${expected} attendus`);
    if (landed !== expected) ok = false;
    report.journal_events = { landed, expected };
    report.ok = ok;
    writeFileSync(join(repo, 'tests/load/capacity-report.json'), JSON.stringify(report, null, 2));
    console.log(`\n${ok ? '✓' : '✗'} Capacité : ${ok ? 'budgets p95 tenus, 0 erreur' : 'budget dépassé ou erreurs'} (${ORGS} structures simultanées).`);
    if (!ok) process.exitCode = 1;
  } finally {
    try {
      const org = `(SELECT id FROM organizations WHERE slug LIKE '${tag}-%')`;
      for (const t of ['sync_operations', 'sync_cursors', 'sync_changelog', 'daily_log_events', 'daily_summaries', 'attendance_events', 'attendance_sessions',
        'notification_queue', 'notification_inbox', 'background_jobs', 'data_access_logs', 'audit_logs', 'child_status_history', 'children', 'org_sequences',
        'sessions', 'devices', 'memberships', 'rooms', 'sites']) {
        await db.query(`DELETE FROM ${t} WHERE organization_id IN ${org}`);
      }
      // Le trigger sync_child_changed ré-insère dans sync_changelog lors du DELETE des enfants : purger une seconde fois.
      await db.query(`DELETE FROM sync_changelog WHERE organization_id IN ${org}`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${tag}-%')`);
      await db.query(`DELETE FROM users WHERE email LIKE '${tag}-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE '${tag}-%'`);
    } catch (e) { console.error('Nettoyage partiel :', e.message); }
    await app.close();
    await db.end();
  }
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
