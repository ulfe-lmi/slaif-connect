import assert from 'node:assert/strict';
import {createMemoryTokenStore} from '../../server/tokens/token_store.js';
import {
  TOKEN_SCOPES,
  TokenRegistryError,
} from '../../server/tokens/token_registry.js';
import {
  consumeWorkloadToken,
  getSafeWorkloadTokenFingerprint,
  issueWorkloadToken,
  validateWorkloadToken,
} from '../../server/workloads/workload_token.js';

async function assertTokenError(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof TokenRegistryError);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected token error ${code}`);
}

let currentTime = Date.parse('2026-05-01T12:00:00.000Z');
const store = createMemoryTokenStore({clock: () => currentTime});

const binding = {
  sessionId: 'sess_workload_token_123',
  hpc: 'vegahpc',
  payloadId: 'gams_chat_v1',
  jobId: '12345',
};

const issued = await issueWorkloadToken(store, {
  ...binding,
  ttlMs: 60000,
});
assert.match(issued.token, /^slaif_tok_[A-Za-z0-9_-]+$/);
assert.equal(issued.record.scope, TOKEN_SCOPES.WORKLOAD);
assert.equal(issued.record.metadata.payloadId, 'gams_chat_v1');
assert.equal(issued.record.metadata.jobId, '12345');

assert.equal((await validateWorkloadToken(store, issued.token, binding)).fingerprint,
    issued.fingerprint);
assert.equal((await consumeWorkloadToken(store, issued.token, binding)).used, 1);
await assertTokenError(() => consumeWorkloadToken(store, issued.token, binding),
    'token_use_exceeded');

const wrongScope = store.issueToken({
  scope: TOKEN_SCOPES.RELAY,
  sessionId: binding.sessionId,
  hpc: binding.hpc,
  ttlMs: 60000,
  metadata: {payloadId: binding.payloadId, jobId: binding.jobId},
});
await assertTokenError(() => validateWorkloadToken(store, wrongScope.token, binding),
    'wrong_scope');

for (const [patch, code] of [
  [{sessionId: 'sess_other_token_123'}, 'wrong_sessionId'],
  [{hpc: 'otherhpc'}, 'wrong_hpc'],
  [{payloadId: 'gpu_diagnostics_v1'}, 'wrong_payloadId'],
  [{jobId: '67890'}, 'wrong_jobId'],
]) {
  const token = await issueWorkloadToken(store, {
    ...binding,
    ttlMs: 60000,
  });
  await assertTokenError(() => validateWorkloadToken(store, token.token, {
    ...binding,
    ...patch,
  }), code);
}

const jobBound = await issueWorkloadToken(store, {
  ...binding,
  ttlMs: 60000,
});
await assertTokenError(() => consumeWorkloadToken(store, jobBound.token, {
  sessionId: binding.sessionId,
  hpc: binding.hpc,
  payloadId: binding.payloadId,
}), 'wrong_jobId');
assert.equal((await validateWorkloadToken(store, jobBound.token, binding)).used, 0);

const noJob = await issueWorkloadToken(store, {
  sessionId: binding.sessionId,
  hpc: binding.hpc,
  payloadId: 'gpu_diagnostics_v1',
  ttlMs: 60000,
});
assert.equal((await consumeWorkloadToken(store, noJob.token, {
  sessionId: binding.sessionId,
  hpc: binding.hpc,
  payloadId: 'gpu_diagnostics_v1',
})).metadata.jobId, undefined);

const expired = await issueWorkloadToken(store, {
  ...binding,
  ttlMs: 1000,
});
currentTime += 2000;
await assertTokenError(() => validateWorkloadToken(store, expired.token, binding),
    'expired_token');

const fingerprint = getSafeWorkloadTokenFingerprint(store, issued.token);
assert.equal(fingerprint, issued.fingerprint);
assert.equal(fingerprint.includes(issued.token), false);

try {
  await validateWorkloadToken(store, 'not-a-real-token-value', binding);
} catch (error) {
  assert.equal(error.code, 'unknown_token');
  assert.equal(String(error.message).includes('not-a-real-token-value'), false);
}

console.log('workload token tests OK');
