#!/usr/bin/env node
// Revue de claims OpenAPI (PR #45) : soit générer réellement, soit corriger la
// doc. Ce test vérifie l'état HONNÊTE — la spec existe et se génère, mais elle
// est écrite à la main, partielle (13 paths), non branchée au build — et que
// les documents ne prétendent plus le contraire. Un test rouge ici = une
// affirmation documentaire regonflée silencieusement.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SPEC = readFileSync('packages/api-contracts/openapi.yaml', 'utf8');
const declaredPaths = [...SPEC.matchAll(/^  (\/[^\s:]+):$/gm)].map(m => m[1]);

test('spec OpenAPI 3.1 parses, declares exactly the reviewed 13-path perimeter', () => {
  assert.match(SPEC, /^openapi:\s*3\.1/m);
  assert.deepEqual(declaredPaths.sort(), [
    '/auth/2fa/disable', '/auth/2fa/enable', '/auth/2fa/verify', '/auth/change-password',
    '/auth/login', '/auth/logout', '/auth/refresh', '/devices', '/devices/{id}/revoke',
    '/health', '/me', '/rooms', '/rooms/{id}',
  ].sort());
  for (const p of declaredPaths) {
    const block = SPEC.slice(SPEC.indexOf(`  ${p}:`));
    const next = block.slice(2).search(/\n  \//);
    const body = next === -1 ? block : block.slice(0, next);
    assert.match(body, /\n    (get|post|put|patch|delete):/, `${p} declares at least one operation`);
    assert.match(body, /responses:/, `${p} declares responses`);
  }
});

test('every documented path is backed by a real controller route (no phantom contract)', () => {
  const files = spawnSync('node', ['-e', [
    'const {readdirSync,readFileSync,statSync}=require("node:fs");const {join}=require("node:path");',
    'const out=[];const walk=(d)=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);',
    '  if(e.isDirectory())walk(p);else if(e.name.endsWith(".controller.ts"))out.push(readFileSync(p,"utf8"));}};',
    'walk("apps/api/src");console.log(JSON.stringify(out));'].join('')], { encoding: 'utf8' });
  assert.equal(files.status, 0);
  const sources = JSON.parse(files.stdout);
  const routes = new Set();
  for (const src of sources) {
    const base = /@Controller\('([^']*)'\)/.exec(src)?.[1] ?? '';
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)) {
      routes.add(`/${base}/${m[2]}`.replace(/\/+/g, '/').replace(/\/$/, ''));
    }
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\(\)/g)) routes.add(`/${base}`.replace(/\/+$/, ''));
  }
  for (const p of declaredPaths) {
    const concrete = p.replace(/\{[^}]+\}/g, ':id');
    const candidates = [concrete, `/api/v1${concrete}`, `/api/v1/${concrete.slice(1)}`];
    assert.ok(candidates.some(r => routes.has(r)), `${p} absent des contrôleurs réels (${[...routes].filter(r => r.includes(concrete.slice(1, 8))).slice(0, 3).join(' ') || 'aucune piste'})`);
  }
});

test('generator works for real but is NOT wired to the build (status quo documented)', () => {
  const root = process.cwd();
  rmSync(join(root, 'packages/api-contracts/dist'), { recursive: true, force: true });
  const run = spawnSync('npm', ['run', 'generate', '--workspace', '@creche/api-contracts'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const generated = readFileSync(join(root, 'packages/api-contracts/dist/client.d.ts'), 'utf8');
  assert.ok(generated.includes('paths'), 'client.d.ts must carry the paths type map');
  assert.ok(generated.includes('/auth/refresh'), 'documented operations must be typed');
  const ignored = spawnSync('git', ['check-ignore', 'packages/api-contracts/dist/client.d.ts'], { encoding: 'utf8' });
  assert.equal(ignored.status, 0, 'generated artifacts stay out of Git');
  const rootBuild = JSON.parse(readFileSync('package.json', 'utf8')).scripts.build;
  const pkg = JSON.parse(readFileSync('packages/api-contracts/package.json', 'utf8'));
  assert.ok(rootBuild.includes('--if-present') && !('build' in (pkg.scripts ?? {})),
    'api-contracts has no build script: generation stays on-demand (do not wire it without a client decision)');
});

test('the spec header itself never re-claims build-wired generation (lot F)', () => {
  assert.equal(SPEC.includes('régénéré par le backend NestJS à chaque build'), false,
    'openapi.yaml header must stay honest: hand-written partial spec, generation on demand');
  assert.match(SPEC, /écrite À LA\s*\n?\s*MAIN|écrite À LA MAIN/i, 'header must say the spec is hand-written');
  assert.match(SPEC, /13 paths/, 'header must state the real perimeter');
});

test('documentation claims match the delivered state (corrected 2026-09, never re-inflated)', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /Contrats API \| OpenAPI 3\.1 \*\*partiel\*\*/);
  assert.match(readme, /13 paths/);
  assert.equal(/Contrats API \| OpenAPI 3\.1 \|[^\n]*régénér/i.test(readme), false);
  const adr = readFileSync('docs/adr/ADR-004-clients-api.md', 'utf8');
  assert.match(adr, /à la demande/);
  assert.match(adr, /implémenté partiellement/i);
  assert.equal(adr.includes('régénéré à chaque build'), false, 'the historical false claim must stay corrected');
  const plan = readFileSync('docs/PLAN_IMPLEMENTATION.md', 'utf8');
  assert.equal(plan.includes('est générée à chaque build et versionnée'), false, 'PLAN_IMPLEMENTATION must not claim build-wired generation');
  const execPlan = readFileSync('docs/PLAN_EXECUTION_PROCHAINES_PHASES.md', 'utf8');
  assert.match(execPlan, /13 paths écrits à la main/);
});

test('coverage honesty: the sync contract stays a separate artifact, not an exhaustive HTTP contract', () => {
  const plan = readFileSync('docs/PLAN_CORRECTION_AUDIT_2026-09.md', 'utf8');
  assert.match(plan, /\[x\] \*\*OpenAPI — vérifié et claims corrigés\*\*/, 'the audit item must record the verification, not stay vague');
  const sync = readFileSync('docs/architecture/sync-contract.md', 'utf8');
  assert.match(sync, /contrat/i, 'F1 sync contract remains the only generated-code contract');
});
