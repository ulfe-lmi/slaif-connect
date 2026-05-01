import assert from 'node:assert/strict';
import {
  createTokenRegistry,
  TOKEN_SCOPES,
  TokenRegistryError,
} from '../../server/tokens/token_registry.js';

function assertTokenError(fn, code) {
  assert.throws(fn, (error) => {
    assert(error instanceof TokenRegistryError);
    assert.equal(error.code, code);
    return true;
  });
}

let currentTime = Date.parse('2026-04-30T12:00:00.000Z');
const registry = createTokenRegistry({clock: () => currentTime});

const issued = registry.issueToken({
  scope: TOKEN_SCOPES.RELAY,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  origin: 'http://127.0.0.1:1234',
  ttlMs: 60000,
  maxUses: 1,
  metadata: {purpose: 'relay-test'},
});

assert.match(issued.token, /^slaif_tok_[A-Za-z0-9_-]+$/);
assert.notEqual(issued.fingerprint.includes(issued.token), true);
assert.equal(issued.record.used, 0);

assert.equal(registry.validateToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  origin: 'http://127.0.0.1:1234',
}).metadata.purpose, 'relay-test');

assertTokenError(() => registry.validateToken(issued.token, {
  scope: TOKEN_SCOPES.LAUNCH,
}), 'wrong_scope');
assertTokenError(() => registry.validateToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
  sessionId: 'sess_other_123456',
}), 'wrong_sessionId');
assertTokenError(() => registry.validateToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
  hpc: 'otherhpc',
}), 'wrong_hpc');
assertTokenError(() => registry.validateToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
  origin: 'http://localhost:1234',
}), 'wrong_origin');

registry.consumeToken(issued.token, {scope: TOKEN_SCOPES.RELAY});
assertTokenError(() => registry.consumeToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
}), 'token_use_exceeded');

const multi = registry.issueToken({
  scope: TOKEN_SCOPES.JOB_REPORT,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  ttlMs: 60000,
  maxUses: 2,
});
registry.consumeToken(multi.token, {scope: TOKEN_SCOPES.JOB_REPORT});
registry.consumeToken(multi.token, {scope: TOKEN_SCOPES.JOB_REPORT});
assertTokenError(() => registry.consumeToken(multi.token, {
  scope: TOKEN_SCOPES.JOB_REPORT,
}), 'token_use_exceeded');

const workload = registry.issueToken({
  scope: TOKEN_SCOPES.WORKLOAD,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  ttlMs: 60000,
  maxUses: 1,
  metadata: {
    payloadId: 'gams_chat_v1',
    jobId: '424242',
  },
});
assert.equal(registry.validateToken(workload.token, {
  scope: TOKEN_SCOPES.WORKLOAD,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  metadata: {
    payloadId: 'gams_chat_v1',
    jobId: '424242',
  },
}).metadata.payloadId, 'gams_chat_v1');
assertTokenError(() => registry.validateToken(workload.token, {
  scope: TOKEN_SCOPES.WORKLOAD,
  metadata: {payloadId: 'gpu_diagnostics_v1'},
}), 'wrong_payloadId');

const launchWithPayload = registry.issueToken({
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  ttlMs: 60000,
  maxUses: 1,
  metadata: {payloadId: 'gpu_diagnostics_v1'},
});
assert.equal(registry.validateToken(launchWithPayload.token, {
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  metadata: {payloadId: 'gpu_diagnostics_v1'},
}).metadata.payloadId, 'gpu_diagnostics_v1');
assertTokenError(() => registry.validateToken(launchWithPayload.token, {
  scope: TOKEN_SCOPES.LAUNCH,
  metadata: {payloadId: 'gams_chat_v1'},
}), 'wrong_payloadId');

const expired = registry.issueToken({
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  ttlMs: 1000,
});
currentTime += 2000;
assertTokenError(() => registry.validateToken(expired.token, {
  scope: TOKEN_SCOPES.LAUNCH,
}), 'expired_token');
assert.equal(registry.cleanupExpired() >= 1, true);

const revoked = registry.issueToken({
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId: 'sess_token_test_123',
  hpc: 'test-sshd',
  ttlMs: 60000,
});
assert.equal(registry.revokeToken(revoked.fingerprint), true);
assertTokenError(() => registry.validateToken(revoked.token, {
  scope: TOKEN_SCOPES.LAUNCH,
}), 'revoked_token');

const fingerprintA = registry.getSafeTokenFingerprint('secret-token-value-123');
const fingerprintB = registry.getSafeTokenFingerprint('secret-token-value-123');
assert.equal(fingerprintA, fingerprintB);
assert.notEqual(fingerprintA.includes('secret-token-value-123'), true);

assertTokenError(() => registry.validateToken('not-a-real-token-value', {
  scope: TOKEN_SCOPES.RELAY,
}), 'unknown_token');
try {
  registry.validateToken('not-a-real-token-value', {scope: TOKEN_SCOPES.RELAY});
} catch (error) {
  assert.equal(String(error.message).includes('not-a-real-token-value'), false);
}

console.log('token registry tests OK');
