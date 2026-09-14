#!/usr/bin/env node
/** Real Flutter unit/Drift gate. No changes to workflows, no SDK in Git.
 * Docker copies sources to ephemeral storage: pub/test never alter checkout.
 * On error, bounded synthetic build/test output is exposed as a CI annotation.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docker = process.env.GITHUB_ACTIONS === 'true' || process.env.FLUTTER_USE_DOCKER === '1';
const script = 'set -eu; cp -a /source/apps/staff-mobile /tmp/staff; cd /tmp/staff; flutter pub get; flutter test test/sync_f2_test.dart --reporter expanded';
const result = spawnSync(docker ? 'docker' : 'flutter', docker ? [
  'run', '--rm', '-v', `${root}:/source:ro`, '--entrypoint', 'bash',
  'ghcr.io/cirruslabs/flutter:3.35.4', '-c', script,
] : ['test', 'test/sync_f2_test.dart', '--reporter', 'expanded'], {
  cwd: docker ? root : resolve(root, 'apps/staff-mobile'),
  encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error || result.status !== 0) {
  const details = `${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-14000);
  console.error('::error title=F2 Flutter gate::' + details.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  process.exit(result.status || 1);
}
console.log('✓ F2 : real Flutter tests passed (not an Android release/F4 gate).');
