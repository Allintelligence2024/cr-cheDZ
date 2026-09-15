#!/usr/bin/env node
/** F1 gate: generated files + AJV/DTO conformance + real Dart serialization.
 * Local: --node-only is explicit and DOES NOT validate Dart. CI forbids it.
 * No SDK in Git, no workflow changes. Docker runs Dart without network/deps.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertSchema } from '../tests/contracts/schema-validator.mjs';
import { acceptsDto } from '../tests/contracts/dto-validator.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ci = process.env.GITHUB_ACTIONS === 'true';
const nodeOnly = process.argv.includes('--node-only');
if (ci && nodeOnly) throw new Error('CI must execute Dart, not --node-only');
function run(command, args, capture = false) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', timeout: 300000 });
  if (r.error || r.status !== 0) throw new Error(`F1 gate failed: ${command} (exit ${r.status}): ${r.error ?? ''}`);
  return r.stdout;
}
run(process.execPath, ['scripts/generate-sync-contract.mjs', '--check']);
run(process.execPath, ['--test', 'tests/contracts/sync-contract.test.mjs']);
if (nodeOnly) {
  console.log('F1 PARTIEL local : schema/DTO/génération OK ; Dart NON exécuté, gate deux côtés NON validé.');
} else {
  let output;
  if (!ci && process.env.SYNC_USE_DOCKER !== '1') {
    output = run('dart', ['tests/contracts/sync-wire-fixtures.dart'], true);
  } else {
    // Explicit version, no latest/stable drift; not an Android release gate.
    output = run('docker', ['run', '--rm', '--network=none', '-e', 'DART_SUPPRESS_ANALYTICS=true',
      '-v', `${root}:/work:ro`, '-w', '/tmp', 'dart:3.9.4-sdk',
      'dart', '/work/tests/contracts/sync-wire-fixtures.dart'], true);
  }
  const result = JSON.parse(output);
  assert.match(result.dart_version, /^3\./);
  assert.ok(result.conformance_cases >= 49);
  assert.equal(result.invalid_request_blocked, true);
  assert.equal(result.invalid_response_blocked, true);
  assert.equal(result.transport_error_propagated, true);
  assert.equal(result.emitted.length, 6);
  const shapes = { '/devices': ['POST', 'RegisterRequest'], '/sync/push': ['POST', 'PushRequest'], '/sync/pull': ['GET', 'PullQuery'] };
  for (const request of result.emitted) {
    const [method, definition] = shapes[request.path] ?? [];
    assert.equal(request.method, method);
    assertSchema(definition, request.data);
    assert.equal(await acceptsDto(definition, request.data), true, `Dart → DTO ${definition}`);
  }
  assert.deepEqual(result.emitted[1], result.emitted[2], 'Replay changes event_id/body');
  assert.equal(result.emitted[4].data.cursor, '9007199254740993');
  assert.equal(result.emitted[5].data.cursor, '9223372036854775807');
  const report = resolve(mkdtempSync(resolve(tmpdir(), 'creche-sync-contract-')), 'dart-fixtures.json');
  writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
  // Synthetic fixture values only, no credentials or real personal data.
  console.log('F1_DART_FIXTURES ' + JSON.stringify(result));
  console.log(`✓ F1 : Dart ${result.dart_version}, ${result.conformance_cases} cas communs, 6 requêtes émises → schéma + DTO TS. Rapport ${report}`);
  console.log('F4 NON validé : transport enregistreur, pas le moteur Flutter/Drift contre API.');
}
