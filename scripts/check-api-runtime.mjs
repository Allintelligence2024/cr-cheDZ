#!/usr/bin/env node
/** H1: reproduce the runtime image layout without Docker or a database.
 * Fresh locked production install in /tmp: no parent workspace node_modules may
 * accidentally satisfy an omitted runtime dependency. No package installation
 * command other than npm ci, and no lockfile re-resolution.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
const dir = mkdtempSync(join(tmpdir(), 'creche-api-runtime-'));
const install = join(dir, 'install'), image = join(dir, 'image');
const copy = (src, dst) => { mkdirSync(resolve(dst, '..'), { recursive: true }); cpSync(src, dst, { recursive: true, verbatimSymlinks: true }); };
try {
  for (const file of ['package.json', 'package-lock.json']) copy(join(root, file), join(install, file));
  for (const area of ['apps', 'packages']) for (const entry of readdirSync(join(root, area))) {
    const file = join(area, entry, 'package.json');
    if (existsSync(join(root, file))) copy(join(root, file), join(install, file));
  }
  const lock = readFileSync(join(install, 'package-lock.json'), 'utf8');
  const result = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: install, encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(join(install, 'package-lock.json'), 'utf8'), lock, 'npm ci changed the lockfile');
  // Delivered COPY layout, including workspace modules only when the Dockerfile
  // really ships them. Never satisfy an import from the development install.
  for (const file of ['package.json', 'package-lock.json', 'node_modules']) copy(join(install, file), join(image, file));
  cpSync(join(root, 'packages'), join(image, 'packages'), { recursive: true, verbatimSymlinks: true,
    filter: path => !path.split(sep).includes('node_modules') });
  for (const entry of readdirSync(join(install, 'packages'))) {
    const modules = join('packages', entry, 'node_modules');
    if (existsSync(join(install, modules))) copy(join(install, modules), join(image, modules));
  }
  if (/^COPY --from=build \/app\/apps\/api\/node_modules \.\/apps\/api\/node_modules$/m.test(readFileSync(join(root,'apps/api/Dockerfile'),'utf8'))) {
    if (existsSync(join(install,'apps/api/node_modules'))) copy(join(install,'apps/api/node_modules'),join(image,'apps/api/node_modules'));
  }
  for (const file of ['package.json', 'dist', 'operations']) copy(join(root, 'apps/api', file), join(image, 'apps/api', file));
  const loaded = spawnSync(process.execPath, ['-e', "require('./apps/api/dist/app.factory.js'); console.log('API runtime imports loaded')"], {
    cwd: image, encoding: 'utf8', timeout: 30000,
    // No NODE_PATH inherited from the development workspace.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'staging' },
  });
  assert.equal(loaded.status, 0, `${loaded.error ?? ''}\n${loaded.stdout}\n${loaded.stderr}`);
  process.stdout.write(loaded.stdout);
  const dependencies = JSON.parse(readFileSync(join(root, 'apps/api/package.json'))).dependencies;
  for (const name of ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']) assert.ok(dependencies[name], `API must own its runtime dependency ${name}`);
  console.log('✓ API production imports: fresh npm ci --omit=dev, delivered image layout, no development module fallback.');
} finally { rmSync(dir, { recursive: true, force: true }); }
