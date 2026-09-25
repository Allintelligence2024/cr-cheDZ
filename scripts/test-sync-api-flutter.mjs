#!/usr/bin/env node
// F4 gate: Node keeps the REAL API event loop alive while Flutter uses real HTTP.
// No reconstructed requests/FakeApi. Fixtures and credentials are ephemeral only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from '../tests/tenant-isolation/helpers.mjs';
import { flutterImage, flutterBootstrap } from './flutter-sdk.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const docker = process.env.GITHUB_ACTIONS === 'true' || process.env.FLUTTER_USE_DOCKER === '1';
const adminUrl = process.env.DATABASE_URL;
assert.ok(new URL(adminUrl).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: adminUrl }); await db.connect();
const dir = mkdtempSync(resolve(tmpdir(), 'creche-f4-'));
let app, pool;
try {
  await ensureAppRole(db);
  const password = `F4-${randomBytes(18).toString('hex')}!`;
  const hash = await bcrypt.hash(password, 4);
  async function identity() {
    const tag = randomUUID(), email = `f4-${tag}@test.dz`;
    const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'F4 synthetic','31') RETURNING id", [`f4-${tag}`])).rows[0].id;
    const user = (await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F4','Synthetic',$2,'active') RETURNING id", [email, hash])).rows[0].id;
    await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [org, user]);
    const site = (await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F4 site') RETURNING id", [org])).rows[0].id;
    return { email, org, user, site };
  }
  const a = await identity(), b = await identity();
  process.env.DATABASE_URL = appUrl(); process.env.NODE_ENV = 'test'; process.env.RATE_LIMIT_DISABLED = 'true';
  const { createApp } = await import('../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0, '127.0.0.1');
  const mount = docker ? '/run/f4' : dir;
  writeFileSync(resolve(dir, 'config.json'), JSON.stringify({ base_url: `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`, email: a.email, other_email: b.email, password, site_id: a.site, report_path: `${mount}/report.json` }), { mode: 0o600 });
  const script = `${docker ? flutterBootstrap : 'set -eu\n'}
${docker ? 'cp -a /source/apps/staff-mobile /tmp/staff\ncd /tmp/staff' : ''}
before="$(sha256sum pubspec.lock)"
flutter pub get --enforce-lockfile
flutter test --no-pub --reporter expanded --dart-define=F4_CONFIG=${mount}/config.json test_live/sync_api_f4_test.dart
test "$before" = "$(sha256sum pubspec.lock)"`;
  let output = '';
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(docker ? 'docker' : 'bash', docker ? ['run', '--rm', '--network=host', '-v', `${root}:/source:ro`, '-v', `${dir}:/run/f4`, '--entrypoint', 'bash', flutterImage, '-c', script] : ['-c', script], { cwd: docker ? root : resolve(root, 'apps/staff-mobile'), stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
    // Bounded logs, scrub the synthetic password if a framework happens to log it.
    function log(data) { const text = data.toString().replaceAll(password, '[redacted]'); output = (output + text).slice(-24000); process.stdout.write(text); }
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.on('error', reject); child.on('close', resolveResult);
  });
  if (result !== 0) {
    for (let i = 0; i < output.length; i += 2000) {
      console.error(`::error title=F4 Flutter API ${String(i / 2000 + 1).padStart(2, '0')}::` + output.slice(i, i + 2000).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
    }
    throw new Error(`Real Flutter/API gate failed (${result})`);
  }
  const report = JSON.parse(readFileSync(resolve(dir, 'report.json'), 'utf8'));
  assert.equal(report.restart_and_tenant_isolation, true);
  const operations = (await db.query('SELECT event_id,status,response_outcome FROM sync_operations WHERE organization_id=$1 ORDER BY client_sequence', [a.org])).rows;
  assert.equal(operations.length, 11, 'replay created duplicate operations');
  assert.equal(operations.find(r => r.event_id === report.accepted_event)?.status, 'accepted');
  assert.deepEqual(operations.find(r => r.event_id === report.conflict_event)?.response_outcome, { status: 'conflict', reason: 'VERSION_MISMATCH', currentVersion: 1 });
  for (const id of report.journal_events) assert.equal(operations.find(r=>r.event_id===id)?.status,'accepted');
  // D6 (option c) : la photo hors ligne est REFUSÉE — l'opération reste traçable
  // avec son motif, au lieu d'« accepter » un asset sans octets.
  assert.equal(report.offline_photo_refused, true, 'le refus de la photo hors ligne doit être prouvé côté client');
  assert.equal(operations.find(r=>r.event_id===report.photo_event)?.status,'rejected');
  assert.equal(operations.find(r=>r.event_id===report.photo_event)?.rejection_reason,'OFFLINE_PHOTO_UNSUPPORTED');
  const journal = (await db.query('SELECT sync_event_id,event_type,event_date::text FROM daily_log_events WHERE child_id=$1',[report.child_id])).rows;
  assert.equal(journal.length,9); assert.deepEqual(new Set(journal.map(r=>r.sync_event_id).filter(Boolean)),new Set(report.journal_events));
  assert.deepEqual(new Set(journal.map(r=>r.event_type)),new Set(['meal','nap_start','nap_end','diaper','activity','temperature','note','incident','health_observation']));
  // 1 photo en LIGNE seulement (la photo hors ligne n'existe plus — D6).
  assert.equal((await db.query('SELECT 1 FROM media_assets WHERE child_id=$1',[report.child_id])).rowCount,1);
  assert.deepEqual((await db.query('SELECT aggregate_type,count(*)::int AS n FROM sync_changelog WHERE organization_id=$1 GROUP BY aggregate_type ORDER BY aggregate_type',[a.org])).rows,
    [{aggregate_type:'attendance',n:1},{aggregate_type:'child',n:1},{aggregate_type:'daily_log',n:9},{aggregate_type:'media',n:2}]);
  const sessions = (await db.query('SELECT status,version FROM attendance_sessions WHERE child_id=$1', [report.child_id])).rows;
  assert.deepEqual(sessions, [{ status: 'present', version: 1 }], 'conflict/replay changed business state');
  assert.equal((await db.query('SELECT 1 FROM attendance_events WHERE child_id=$1', [report.child_id])).rowCount, 1);
  assert.equal((await db.query('SELECT 1 FROM devices WHERE organization_id=$1 AND registered_by=$2', [a.org, a.user])).rowCount, 2, 'restart registered another device');
  assert.equal((await db.query('SELECT 1 FROM media_assets WHERE organization_id=$1 AND child_id IS NULL AND media_type=$2',[a.org,'document'])).rowCount,1);
  assert.notEqual(report.device_a, report.device_b);
  console.log('::notice title=F4 Flutter API passed::7 real Flutter/Drift tests against live HTTP API + PostgreSQL assertions passed: two devices, push/pull, replay, conflict, restart, tenant isolation. All four produced types including journal/media metadata. No Android release or offline media binaries claimed.');
} finally {
  if (app) await app.close(); if (pool) await pool.end(); await db.end(); rmSync(dir, { recursive: true, force: true });
}
