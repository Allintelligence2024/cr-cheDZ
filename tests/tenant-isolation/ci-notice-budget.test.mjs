import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// GitHub limits notices to ten per step. All strict-gate subprocesses run in
// the same workflow step: reserve four for H1 dev/staging, F2 and F4.
// https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md#limitations
// CI 34907534465 was green but dropped the eleventh notice (H2g).
test('strict gate budgets notices for H1/F2/F4 and aggregates every H2 count', () => {
  const source = readFileSync(new URL('../../scripts/test-production-roles.mjs', import.meta.url), 'utf8');
  const directNotices = (source.match(/::notice title=/g) ?? []).length;
  assert.ok(directNotices + 4 <= 10,
    `${directNotices + 4} notices in one step exceed GitHub's ten-notice limit`);
  const aggregate = source.split('\n').find(line => line.includes('::notice title=H2 confidentiality passed::'));
  assert.ok(aggregate, 'one verifiable H2 annotation required');
  for (const [lot, counter] of Object.entries({ H2a: 'confidentiality', H2b: 'revocation', H2c: 'parentAccess', H2d: 'financialProjection', H2e: 'journalHealth', H2f: 'privacyActor', H2g: 'photoConsent', H2h: 'staffDocuments' })) {
    assert.ok(aggregate.includes(lot + '=${' + counter + '[1]}'), `${lot} actual result missing from aggregate`);
  }
});

test('G evidence aggregates actual G1/G1b/G1c/G2/G3 counters without one notice per lot', () => {
  const source = readFileSync(new URL('../../scripts/test-production-roles.mjs', import.meta.url), 'utf8');
  const aggregate = source.split('\n').find(line => line.includes('::notice title=G security passed::'));
  assert.ok(aggregate);
  assert.ok(aggregate.includes('G1=${authHardening[1]}'));
  assert.ok(aggregate.includes('G1b=${refreshRotation[1]}'));
  assert.ok(aggregate.includes('G1c=${invitations[1]}'));
  assert.ok(aggregate.includes('G2=${rlsIntegrity[1]}'));
  assert.ok(aggregate.includes('G3=${dpiaApproval[1]}'));
});
