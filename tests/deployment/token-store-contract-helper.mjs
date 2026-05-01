import assert from 'node:assert/strict';
import {
  TOKEN_SCOPES,
  TokenRegistryError,
} from '../../server/tokens/token_registry.js';

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

export async function assertTokenStoreContract({
  createStore,
  advanceClock,
  mode,
}) {
  const store = await createStore();
  try {
    assert.equal(store.mode, mode);
    const health = await store.healthCheck();
    assert.equal(health.ok, true);

    const issued = await store.issueToken({
      scope: TOKEN_SCOPES.RELAY,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      origin: 'http://127.0.0.1:3000',
      ttlMs: 60000,
      maxUses: 1,
      metadata: {purpose: 'contract'},
    });
    assert.equal((await store.validateToken(issued.token, {
      scope: TOKEN_SCOPES.RELAY,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      origin: 'http://127.0.0.1:3000',
    })).fingerprint, issued.fingerprint);

    await store.consumeToken(issued.token, {scope: TOKEN_SCOPES.RELAY});
    await assertTokenError(() => store.consumeToken(issued.token, {
      scope: TOKEN_SCOPES.RELAY,
    }), 'token_use_exceeded');

    const multi = await store.issueToken({
      scope: TOKEN_SCOPES.JOB_REPORT,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      ttlMs: 60000,
      maxUses: 2,
    });
    await store.consumeToken(multi.token, {scope: TOKEN_SCOPES.JOB_REPORT});
    await store.consumeToken(multi.token, {scope: TOKEN_SCOPES.JOB_REPORT});
    await assertTokenError(() => store.consumeToken(multi.token, {
      scope: TOKEN_SCOPES.JOB_REPORT,
    }), 'token_use_exceeded');

    const workload = await store.issueToken({
      scope: TOKEN_SCOPES.WORKLOAD,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      ttlMs: 60000,
      maxUses: 1,
      metadata: {
        payloadId: 'gams_chat_v1',
        jobId: '424242',
      },
    });
    assert.equal((await store.validateToken(workload.token, {
      scope: TOKEN_SCOPES.WORKLOAD,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      metadata: {
        payloadId: 'gams_chat_v1',
        jobId: '424242',
      },
    })).metadata.payloadId, 'gams_chat_v1');
    await assertTokenError(() => store.consumeToken(workload.token, {
      scope: TOKEN_SCOPES.WORKLOAD,
      metadata: {payloadId: 'gpu_diagnostics_v1'},
    }), 'wrong_payloadId');

    const bound = await store.issueToken({
      scope: TOKEN_SCOPES.LAUNCH,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      origin: 'http://127.0.0.1:3000',
      ttlMs: 60000,
    });
    for (const [expected, code] of [
      [{scope: TOKEN_SCOPES.RELAY}, 'wrong_scope'],
      [{scope: TOKEN_SCOPES.LAUNCH, sessionId: 'sess_other_123'}, 'wrong_sessionId'],
      [{scope: TOKEN_SCOPES.LAUNCH, hpc: 'otherhpc'}, 'wrong_hpc'],
      [{scope: TOKEN_SCOPES.LAUNCH, origin: 'http://localhost:3000'}, 'wrong_origin'],
    ]) {
      await assertTokenError(() => store.validateToken(bound.token, expected), code);
    }

    const expired = await store.issueToken({
      scope: TOKEN_SCOPES.LAUNCH,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      ttlMs: 1000,
    });
    await advanceClock?.(2000);
    await assertTokenError(() => store.validateToken(expired.token, {
      scope: TOKEN_SCOPES.LAUNCH,
    }), 'expired_token');
    assert.equal((await store.cleanupExpired()) >= 0, true);

    const revoked = await store.issueToken({
      scope: TOKEN_SCOPES.LAUNCH,
      sessionId: 'sess_store_contract_123',
      hpc: 'test-sshd',
      ttlMs: 60000,
    });
    assert.equal(await store.revokeToken(revoked.fingerprint), true);
    await assertTokenError(() => store.validateToken(revoked.token, {
      scope: TOKEN_SCOPES.LAUNCH,
    }), 'revoked_token');

    const fingerprint = store.getSafeTokenFingerprint('secret-token-value-for-store');
    assert.match(fingerprint, /^sha256:[a-f0-9]+$/);
    assert.equal(fingerprint.includes('secret-token-value-for-store'), false);
  } finally {
    await store.close?.();
  }
}
