#!/usr/bin/env node
/** Real Flutter unit/Drift gate. No changes to workflows, no SDK in Git.
 * Docker copies sources to ephemeral storage: pub/test never alter checkout.
 * On error, bounded synthetic build/test output is exposed as a CI annotation.
 */
import { flutterImage, flutterBootstrap } from './flutter-sdk.mjs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docker = process.env.GITHUB_ACTIONS === 'true' || process.env.FLUTTER_USE_DOCKER === '1';
const script = `${flutterBootstrap}cp -a /source/apps/staff-mobile /tmp/staff
cd /tmp/staff
flutter pub get --enforce-lockfile
flutter test --no-pub --reporter expanded
flutter analyze --no-pub --no-fatal-infos
cmp /source/apps/staff-mobile/pubspec.lock pubspec.lock`;
const localScript = `set -eu
before="$(sha256sum pubspec.lock)"
flutter pub get --enforce-lockfile
flutter test --no-pub --reporter expanded
flutter analyze --no-pub --no-fatal-infos
test "$before" = "$(sha256sum pubspec.lock)"`;
const result = spawnSync(docker ? 'docker' : 'bash', docker ? [
  'run', '--rm', '-v', `${root}:/source:ro`, '--entrypoint', 'bash',
  flutterImage, '-c', script,
] : ['-c', localScript], {
  cwd: docker ? root : resolve(root, 'apps/staff-mobile'),
  encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error || result.status !== 0) {
  const details = `${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-14000);
  // GitHub truncates individual annotations: keep every chunk below 4 KiB.
  for (let offset = 0; offset < details.length; offset += 2500) {
    const chunk = details.slice(offset, offset + 2500);
    console.error(`::error title=F2 Flutter gate ${offset / 2500 + 1}::` + chunk.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  }
  process.exit(result.status || 1);
}
const count = [...(result.stdout ?? '').matchAll(/\+(\d+): All tests passed!/g)].at(-1)?.[1] ?? 'All';
console.log(`::notice title=F2 Flutter passed::${count} real Flutter tests and analysis passed with the enforced lockfile. Not an Android release or F4 gate.`);
