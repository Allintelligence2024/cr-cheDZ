import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pullRegistryImage } from '../../scripts/registry-pull.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const image = 'quay.io/minio/minio:release@sha256:fixture';
const timeout = { status: 1, stderr: 'Get "https://quay.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)' };
function fixture(results) {
  const calls = [], pauses = [], warnings = [];
  return { calls, pauses, warnings, options: {
    run: (command, args) => { calls.push([command, args]); return results[Math.min(calls.length - 1, results.length - 1)]; },
    pause: async ms => { pauses.push(ms); }, warn: message => warnings.push(message),
  } };
}
test('successful immutable image pull runs once', async () => {
  const f = fixture([{status: 0, stdout: 'Digest verified'}]);
  assert.equal(await pullRegistryImage(image, f.options), 'Digest verified');
  assert.deepEqual(f.calls, [['docker', ['pull', image]]]); assert.deepEqual(f.pauses, []);
});
test('observed Quay network timeout retries the SAME image with bounded backoff', async () => {
  const f = fixture([timeout, timeout, {status: 0, stdout: 'Digest verified'}]);
  assert.equal(await pullRegistryImage(image, f.options), 'Digest verified');
  assert.equal(f.calls.length, 3); assert.deepEqual(f.pauses, [2000, 4000]);
  for (const call of f.calls) assert.deepEqual(call, ['docker', ['pull', image]]);
  assert.equal(f.warnings.length, 2);
  for (const warning of f.warnings) assert.match(warning, /^::warning /);
});
test('registry client timeout retries, without claiming success prematurely', async () => {
  const f = fixture([{status: null, error: Object.assign(new Error('timed out'), {code:'ETIMEDOUT'})}, {status:0}]);
  await pullRegistryImage(image, f.options); assert.equal(f.calls.length, 2);
});
for (const message of ['pull access denied', 'manifest unknown', 'unauthorized: authentication required', 'unexpected fatal error']) {
  test(`${message}: permanent errors fail immediately`, async () => {
    const f = fixture([{status:1, stderr:message}]);
    await assert.rejects(pullRegistryImage(image, f.options), /Registry pull failed/);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.pauses, []);
  });
}
// H1 tire DEUX images (postgres + minio) : « unauthorized » sans le nom de
// l'image est inexploitable pour l'ops — le message doit désigner la coupable.
test('the failing image is named in the error (H1 pulls two images)', async () => {
  for (const target of ['postgres:18-alpine', 'quay.io/minio/minio']) {
    const f = fixture([{status:1, stderr:'unauthorized: access to the requested resource is not authorized'}]);
    await assert.rejects(pullRegistryImage(target, f.options), (error) => {
      assert.match(error.message, /Registry pull failed for /);
      assert.ok(error.message.includes(target), `le message doit citer ${target} : ${error.message}`);
      assert.match(error.message, /unauthorized/);
      return true;
    });
  }
});
test('persistent network failure stays red after three attempts', async () => {
  const f = fixture([timeout]);
  await assert.rejects(pullRegistryImage(image, f.options), /Registry pull failed/);
  assert.equal(f.calls.length, 3); assert.equal(f.pauses.length, 2);
});

/**
 * H1 (24/09/2026) : le runner ne tire pas `quay.io/minio/minio` anonymement
 * (« unauthorized ») alors que `postgres:18-alpine` (Docker Hub) passe — la
 * boucle essaie postgres EN PREMIER. Deux remédiations d'exploitation sont
 * câblées et doivent le rester, sans jamais fabriquer un vert :
 *   1. identifiants facultatifs (secrets de dépôt) → connexion Quay dans le job ;
 *   2. sans secret : `MINIO_IMAGE` pointe un miroir (défaut épinglé par digest).
 */
test('H1 remediation: opt-in Quay login in CI (skipped without secrets)', () => {
  const workflow = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
  // les deux secrets sont exposés au job (vides par défaut)
  assert.match(workflow, /QUAY_USERNAME: \$\{\{ secrets\.QUAY_USERNAME \}\}/);
  assert.match(workflow, /QUAY_PASSWORD: \$\{\{ secrets\.QUAY_PASSWORD \}\}/);
  // la connexion est CONDITIONNELLE et n'écrit jamais le mot de passe en clair
  const login = workflow.match(/^\s+- name: Registre Quay[\s\S]*?\n\s+run: (.*)$/m);
  assert.ok(login, 'étape de connexion Quay absente');
  assert.match(workflow, /if: env\.QUAY_USERNAME != ''/, 'la connexion doit être facultative (sans secrets : ignorée)');
  assert.match(login[1], /docker login quay\.io/);
  assert.match(login[1], /--password-stdin/, 'mot de passe par stdin, jamais en argument');
  assert.doesNotMatch(login[1], /--password[= ][^\s"$]/, 'mot de passe littéral interdit');
});

test('H1 remediation: MINIO_IMAGE override exists with a digest-pinned default', () => {
  for (const stage of ['prod', 'staging', 'dev']) {
    const compose = readFileSync(join(repo, 'infrastructure', 'docker', `docker-compose.${stage}.yml`), 'utf8');
    assert.match(
      compose,
      /image: \$\{MINIO_IMAGE:-quay\.io\/minio\/minio:RELEASE\.[^}]*@sha256:[0-9a-f]{64}\}/,
      `${stage} : MinIO doit rester surchargeable avec un défaut épinglé par digest`,
    );
  }
  // Le tirage utilise la config RÉSOLUE par compose : sans cela, la surcharge
  // serait décorative (le script tirerait une image codée en dur).
  const stack = readFileSync(join(repo, 'scripts', 'test-staging-stack.mjs'), 'utf8');
  assert.match(stack, /pullRegistryImage\(config\.services\[name\]\.image/);
});
