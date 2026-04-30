import assert from 'node:assert/strict';
import {
  createTokenStore,
  TokenStoreNotImplementedError,
} from '../../server/tokens/token_store.js';
import {
  TOKEN_SCOPES,
  TokenRegistryError,
} from '../../server/tokens/token_registry.js';

let now = Date.parse('2026-04-30T12:00:00.000Z');
const store = createTokenStore({mode: 'memory'}, {clock: () => now});
assert.equal(store.mode, 'memory');
assert.equal(store.healthCheck().ok, true);
assert.equal(store.healthCheck().durable, false);

const issued = store.issueToken({
  scope: TOKEN_SCOPES.RELAY,
  sessionId: 'sess_store_contract_123',
  hpc: 'test-sshd',
  ttlMs: 60000,
  maxUses: 1,
});
assert.equal(store.validateToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
  sessionId: 'sess_store_contract_123',
  hpc: 'test-sshd',
}).fingerprint, issued.fingerprint);

store.consumeToken(issued.token, {scope: TOKEN_SCOPES.RELAY});
assert.throws(() => store.consumeToken(issued.token, {
  scope: TOKEN_SCOPES.RELAY,
}), (error) => {
  assert(error instanceof TokenRegistryError);
  assert.equal(error.code, 'token_use_exceeded');
  return true;
});

const expired = store.issueToken({
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId: 'sess_store_contract_123',
  hpc: 'test-sshd',
  ttlMs: 1000,
});
now += 2000;
assert.throws(() => store.validateToken(expired.token, {
  scope: TOKEN_SCOPES.LAUNCH,
}), (error) => {
  assert.equal(error.code, 'expired_token');
  return true;
});
assert.equal(store.cleanupExpired() >= 1, true);

assert.throws(() => createTokenStore({mode: 'redis'}), (error) => {
  assert(error instanceof TokenStoreNotImplementedError);
  assert.equal(error.mode, 'redis');
  return true;
});
assert.throws(() => createTokenStore({mode: 'postgres'}), (error) => {
  assert(error instanceof TokenStoreNotImplementedError);
  assert.equal(error.mode, 'postgres');
  return true;
});

const fingerprint = store.getSafeTokenFingerprint('secret-token-value-for-store');
assert.match(fingerprint, /^sha256:[a-f0-9]+$/);
assert.equal(fingerprint.includes('secret-token-value-for-store'), false);

console.log('token store contract tests OK');
