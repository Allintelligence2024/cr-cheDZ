#!/usr/bin/env node
// H2i: real config/services, entrypoints, PostgreSQL roles and file/HTTP I/O.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as tcpServer } from 'node:net';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureAppRole, appUrl } from './helpers.mjs';
import { validateProductionConfig, assertProductionConfig } from '@creche/prod-config';
import { ConfigService } from '@nestjs/config';
import { PdfStorageService } from '../../apps/api/dist/modules/billing/pdf-storage.service.js';
import { ExportsService } from '../../apps/api/dist/modules/exports/exports.service.js';
// E1 : client S3 mutualisé — les services se construisent maintenant avec
// (config, s3) ; on instancie le client avec la même ConfigService que le test.
import { S3ClientService } from '../../apps/api/dist/shared/storage/s3-client.service.js';
const withS3 = (config) => new S3ClientService(config);
import { VideoService } from '../../apps/api/dist/modules/video/video.service.js';
import { storeFile } from '../../apps/worker/dist/pdf.js';

const original = { ...process.env }, root = await mkdtemp(join(tmpdir(), 'h2i-storage-'));
const safe = { NODE_ENV: 'production', JWT_SECRET: 'synthetic-h2i-jwt-0123456789abcdef0123456789', PAYMENT_WEBHOOK_SECRET: 'synthetic-h2i-webhook-0123456789abcdef0123456789', TOTP_ENCRYPTION_KEY: 'c'.repeat(64), STORAGE_BACKEND: 's3', STORAGE_LOCAL_DIR: root, S3_ACCESS_KEY: 'synthetic-h2i-access', S3_SECRET_KEY: 'synthetic-h2i-secret', SENTRY_DSN: '', SATIM_MERCHANT_ID: '', SATIM_SECRET: '', SATIM_GATEWAY_URL: '', FIREBASE_SERVICE_ACCOUNT_JSON: '', WORKER_SCHEDULER_ENABLED: 'false', WORKER_SHUTDOWN_TIMEOUT_MS: '1500', APP_PORT: '0' };
let passed = 0, failed = 0, connections = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } }
const trap = tcpServer(socket => { connections++; socket.destroy(); });
await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
const trapUrl = `postgres://synthetic:synthetic@127.0.0.1:${trap.address().port}/creche_test`;
const setEnv = env => { for (const key of Object.keys(process.env)) delete process.env[key]; for (const [key,value] of Object.entries(env)) if (value !== undefined) process.env[key] = value; };
async function child(entry, env, until) {
  const p = spawn(process.execPath, [entry], { env: { ...original, ...safe, ...env }, stdio: ['ignore','pipe','pipe'] });
  let output = '', ready = false, timedOut = false;
  for (const stream of [p.stdout,p.stderr]) stream.on('data', b => { output += b; if (until && until.test(output)) { ready = true; p.kill('SIGTERM'); } });
  const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, 10000);
  try { const code = await new Promise((resolve,reject) => { p.once('error',reject); p.once('close',resolve); }); return { code, output, ready, timedOut }; }
  finally { clearTimeout(timer); }
}
const db = new pg.Client({ connectionString: original.DATABASE_URL });
try {
  assert.ok(new URL(original.DATABASE_URL).pathname.endsWith('_test'));
  await db.connect(); await ensureAppRole(db);
  for (const backend of ['s3','local']) await check(`production ${backend}: valid explicit configuration retained`, async () => {
    assert.deepEqual(validateProductionConfig({ ...safe, STORAGE_BACKEND: backend }), []);
    assert.doesNotThrow(() => assertProductionConfig({ ...safe, STORAGE_BACKEND: backend }));
  });
  for (const backend of [undefined,'','S3','local ','s33']) await check(`production backend ${JSON.stringify(backend)}: no implicit fallback`, async () => {
    const env = { ...safe, STORAGE_BACKEND: backend };
    assert.match(validateProductionConfig(env).join('\n'), /STORAGE_BACKEND/);
    assert.throws(() => assertProductionConfig(env), /STORAGE_BACKEND/);
  });
  for (const key of ['S3_ACCESS_KEY','S3_SECRET_KEY']) for (const value of [undefined,'','   ']) await check(`s3 ${key} ${JSON.stringify(value)}: absent credential refused`, async () => {
    assert.match(validateProductionConfig({ ...safe, [key]: value }).join('\n'), new RegExp(key));
  });
  for (const [key,value] of [['S3_ACCESS_KEY','minio_dev'],['S3_SECRET_KEY','minio_dev_password']]) await check(`s3 ${key}: development credential remains refused`, async () => {
    assert.match(validateProductionConfig({ ...safe, [key]: value }).join('\n'), new RegExp(key));
  });
  for (const dir of ['', '   ', 'relative/storage', '/tmp/creche-pdf/']) await check(`production local directory ${JSON.stringify(dir)}: ambiguous or default refused`, async () => {
    assert.match(validateProductionConfig({ ...safe, STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: dir }).join('\n'), /STORAGE_LOCAL_DIR/);
  });
  for (const mode of ['test','development','staging']) await check(`${mode}: absent backend still selects the established s3 default`, async () => {
    setEnv({ ...original, ...safe, NODE_ENV: mode, STORAGE_BACKEND: undefined });
    const config = new ConfigService();
    assert.equal(new PdfStorageService(config, withS3(config)).isLocal(), false);
    assert.equal(new VideoService(null, config, null, null).resolveStorageBackend(), 's3');
    assert.doesNotThrow(() => assertProductionConfig(process.env));
  });
  for (const [label, factory] of [
    ['pdf', config => new PdfStorageService(config, withS3(config)).isLocal()],
    ['exports', config => new ExportsService(null, config, withS3(config))],
    ['video', config => new VideoService(null, config, null, null).resolveStorageBackend()],
  ]) for (const backend of [undefined,'','s33']) await check(`${label}: production backend ${JSON.stringify(backend)} refused in actual service`, async () => {
    setEnv({ ...original, ...safe, STORAGE_BACKEND: backend });
    assert.throws(() => factory(new ConfigService()), /STORAGE_BACKEND/);
  });
  await check('production local video remains forbidden (does not forbid local PDFs)', async () => {
    setEnv({ ...original, ...safe, STORAGE_BACKEND: 'local' }); const config = new ConfigService();
    assert.equal(new PdfStorageService(config, withS3(config)).isLocal(), true);
    assert.throws(() => new VideoService(null, config, null, null).resolveStorageBackend(), error => error.code === 'STORAGE_POLICY');
  });
  for (const [label, entry] of [['API','apps/api/dist/main.js'],['worker','apps/worker/dist/main.js']]) {
    for (const [reason, env, diagnostic] of [
      ['missing backend', { STORAGE_BACKEND: undefined }, /STORAGE_BACKEND/],
      ['unknown backend', { STORAGE_BACKEND: 's33' }, /STORAGE_BACKEND/],
      ['missing S3 key', { S3_ACCESS_KEY: undefined }, /S3_ACCESS_KEY/],
      ['blank local path', { STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: '' }, /STORAGE_LOCAL_DIR/],
      ['development typo', { NODE_ENV: 'development', STORAGE_BACKEND: 's33' }, /STORAGE_BACKEND/],
    ]) await check(`${label} entrypoint: ${reason} exits BEFORE PostgreSQL or serving/claim`, async () => {
      const before = connections, result = await child(entry, { ...env, DATABASE_URL: trapUrl });
      assert.equal(result.timedOut, false); assert.equal(result.code, 1); assert.match(result.output, diagnostic);
      assert.equal(connections, before); assert.doesNotMatch(result.output, /API prête|\[worker\] démarré/);
      assert.ok(!result.output.includes(safe.S3_SECRET_KEY), 'no configured credential in diagnostics');
    });
    for (const backend of ['local','s3']) await check(`${label} entrypoint: explicit ${backend} boots against actual application role`, async () => {
      const result = await child(entry, { STORAGE_BACKEND: backend, DATABASE_URL: appUrl() }, label === 'API' ? /API prête/ : /\[worker\] démarré/);
      assert.equal(result.timedOut, false); assert.equal(result.ready, true, result.output);
    });
  }
  await check('actual local worker write and API read use the same tenant-prefixed key', async () => {
    setEnv({ ...original, ...safe, STORAGE_BACKEND: 'local' });
    const key = `${randomUUID()}/invoices/${randomUUID()}.pdf`, data = Buffer.from('synthetic H2i bytes');
    await storeFile(key, data, 'application/pdf');
    const cfg = new ConfigService();
    const pdf = new PdfStorageService(cfg, withS3(cfg));
    assert.equal(pdf.isLocal(), true); assert.deepEqual(await pdf.read(key), data); assert.deepEqual(await readFile(join(root,key)), data);
  });
  await check('actual S3 transport selection: worker PUT and API GET reach loopback provider only', async () => {
    const calls = [], data = Buffer.from('synthetic H2i S3 bytes'); let stored;
    const server = createServer(async (req,res) => {
      const chunks = []; for await (const b of req) chunks.push(b);
      calls.push({ method: req.method, url: req.url });
      if (req.method === 'PUT') { stored = Buffer.concat(chunks); res.end(); } else res.end(stored);
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    try {
      setEnv({ ...original, ...safe, S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, S3_BUCKET: 'synthetic-h2i', S3_REGION: 'us-east-1' });
      const key = `${randomUUID()}/invoices/${randomUUID()}.pdf`;
      await storeFile(key, data, 'application/pdf'); const cfg = new ConfigService(); const pdf = new PdfStorageService(cfg, withS3(cfg));
      assert.equal(pdf.isLocal(), false); assert.deepEqual(await pdf.read(key), data);
      assert.deepEqual(calls.map(x=>x.method), ['PUT','GET']); assert.ok(calls.every(x=>x.url.startsWith(`/synthetic-h2i/${key}`)));
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
} finally {
  setEnv(original); await db.end(); await new Promise(resolve => trap.close(resolve)); await rm(root,{recursive:true,force:true});
}
console.log(`H2i storage selection: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
