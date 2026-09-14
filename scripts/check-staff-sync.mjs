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
// Cirrus has no 3.47.1 image. Bootstrap the exact official tag inside a known,
// digest-pinned tool image; NEVER checkout/reset the application repository.
const flutterCommit = '6655482ec06e547f90abf8ae7590466f4415978d';
const script = `set -eu
sdk="$(dirname "$(dirname "$(readlink -f "$(command -v flutter)")")")"
case "$sdk" in /sdks/flutter|/opt/flutter) ;; *) echo "Unexpected SDK path: $sdk"; exit 1;; esac
git config --global --add safe.directory "$sdk"
git -C "$sdk" fetch --depth 1 origin tag 3.47.1
test "$(git -C "$sdk" rev-parse '3.47.1^{commit}')" = '${flutterCommit}'
git -C "$sdk" checkout --force --detach '${flutterCommit}'
flutter --version
cp -a /source/apps/staff-mobile /tmp/staff
cd /tmp/staff
flutter pub get --enforce-lockfile
flutter test --no-pub --reporter expanded
flutter analyze --no-pub --no-fatal-infos
cmp /source/apps/staff-mobile/pubspec.lock pubspec.lock`;
const result = spawnSync(docker ? 'docker' : 'flutter', docker ? [
  'run', '--rm', '-v', `${root}:/source:ro`, '--entrypoint', 'bash',
  'ghcr.io/cirruslabs/flutter:3.44.0@sha256:46691e311715845de03a3ba4753a475476936805b29431b1f00f1816981033f8', '-c', script,
] : ['test', 'test/sync_f2_test.dart', '--reporter', 'expanded'], {
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
console.log('::notice title=F2 Flutter passed::Real Flutter tests and analysis passed with the enforced lockfile. Not an Android release or F4 gate.');
