import assert from 'node:assert/strict';
import {
  createTokenStore,
  TokenStoreNotImplementedError,
} from '../../server/tokens/token_store.js';
import {assertTokenStoreContract} from './token-store-contract-helper.mjs';

let now = Date.parse('2026-04-30T12:00:00.000Z');

await assertTokenStoreContract({
  mode: 'memory',
  createStore: () => createTokenStore({mode: 'memory'}, {clock: () => now}),
  advanceClock: (ms) => {
    now += ms;
  },
});

const redisStore = createTokenStore({
  mode: 'redis',
  tokenStoreUrl: 'redis://127.0.0.1:6379/15',
  redisKeyPrefix: 'slaif_contract',
});
assert.equal(redisStore.mode, 'redis');
await redisStore.close?.();

assert.throws(() => createTokenStore({mode: 'redis'}), (error) => {
  assert.equal(error.code, 'missing_redis_url');
  return true;
});
assert.throws(() => createTokenStore({mode: 'postgres'}), (error) => {
  assert(error instanceof TokenStoreNotImplementedError);
  assert.equal(error.mode, 'postgres');
  return true;
});

console.log('token store contract tests OK');
