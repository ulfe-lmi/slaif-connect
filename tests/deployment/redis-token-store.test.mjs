import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createClient} from 'redis';
import {createTokenStore} from '../../server/tokens/token_store.js';
import {TOKEN_SCOPES} from '../../server/tokens/token_registry.js';
import {assertTokenStoreContract} from './token-store-contract-helper.mjs';

const prefix = `slaif_test_${crypto.randomBytes(6).toString('hex')}`;
let dockerContainer;

function runDocker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function waitForRedis(url) {
  const client = createClient({url, socket: {connectTimeout: 500}});
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await client.connect();
      assert.equal(await client.ping(), 'PONG');
      await client.quit();
      return;
    } catch (error) {
      lastError = error;
      if (client.isOpen) {
        await client.quit().catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error('Redis did not become ready');
}

async function getRedisUrl() {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  try {
    dockerContainer = runDocker([
      'run',
      '--rm',
      '-d',
      '-p',
      '127.0.0.1::6379',
      'redis:7-alpine',
    ]);
    const endpoint = runDocker(['port', dockerContainer, '6379/tcp']).split('\n')[0];
    const [, port] = endpoint.match(/:(\d+)$/u) || [];
    if (!port) {
      throw new Error(`unable to parse Redis test container port from ${endpoint}`);
    }
    const url = `redis://127.0.0.1:${port}/0`;
    await waitForRedis(url);
    return url;
  } catch (error) {
    throw new Error(
        `Redis test requires REDIS_URL or Docker access to start redis:7-alpine: ${error.message}`,
    );
  }
}

async function cleanupRedis(url) {
  const client = createClient({url});
  await client.connect();
  for await (const entry of client.scanIterator({MATCH: `${prefix}:*`, COUNT: 100})) {
    const keys = Array.isArray(entry) ? entry : [entry];
    if (keys.length > 0) {
      await client.del(keys);
    }
  }
  await client.quit();
}

async function stopDocker() {
  if (dockerContainer) {
    runDocker(['stop', dockerContainer]);
    dockerContainer = undefined;
  }
}

const redisUrl = await getRedisUrl();

try {
  await cleanupRedis(redisUrl);

  await assertTokenStoreContract({
    mode: 'redis',
    createStore: () => createTokenStore({
      mode: 'redis',
      tokenStoreUrl: redisUrl,
      redisKeyPrefix: prefix,
    }),
    advanceClock: () => new Promise((resolve) => setTimeout(resolve, 1100)),
  });

  const storeA = createTokenStore({
    mode: 'redis',
    tokenStoreUrl: redisUrl,
    redisKeyPrefix: prefix,
  });
  const storeB = createTokenStore({
    mode: 'redis',
    tokenStoreUrl: redisUrl,
    redisKeyPrefix: prefix,
  });
  try {
    const issued = await storeA.issueToken({
      scope: TOKEN_SCOPES.RELAY,
      sessionId: 'sess_redis_distributed_123',
      hpc: 'test-sshd',
      origin: 'http://127.0.0.1:3000',
      ttlMs: 60000,
      maxUses: 1,
      metadata: {relayAlias: 'test-sshd'},
    });
    assert.equal((await storeB.validateToken(issued.token, {
      scope: TOKEN_SCOPES.RELAY,
      sessionId: 'sess_redis_distributed_123',
      hpc: 'test-sshd',
      origin: 'http://127.0.0.1:3000',
    })).metadata.relayAlias, 'test-sshd');

    const attempts = await Promise.allSettled([
      storeA.consumeToken(issued.token, {scope: TOKEN_SCOPES.RELAY}),
      storeB.consumeToken(issued.token, {scope: TOKEN_SCOPES.RELAY}),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'token_use_exceeded');

    const client = createClient({url: redisUrl});
    await client.connect();
    const rawRecord = await client.get(storeA._unsafeDebugKeyForToken(issued.token));
    await client.quit();
    assert(rawRecord);
    assert.equal(rawRecord.includes(issued.token), false);
    assert.equal(rawRecord.includes('test-sshd'), true);
    await assert.rejects(() => storeB.validateToken('not-a-real-token-value', {
      scope: TOKEN_SCOPES.RELAY,
    }), (error) => {
      assert.equal(error.code, 'unknown_token');
      assert.equal(String(error.message).includes('not-a-real-token-value'), false);
      return true;
    });
    const ttlClient = createClient({url: redisUrl});
    await ttlClient.connect();
    const ttlMs = await ttlClient.pTTL(storeA._unsafeDebugKeyForToken(issued.token));
    await ttlClient.quit();
    assert(ttlMs > 0);

    const revoked = await storeA.issueToken({
      scope: TOKEN_SCOPES.JOB_REPORT,
      sessionId: 'sess_redis_revoked_123',
      hpc: 'test-sshd',
      ttlMs: 60000,
    });
    assert.equal(await storeB.revokeToken(revoked.fingerprint), true);
    await assert.rejects(() => storeA.validateToken(revoked.token, {
      scope: TOKEN_SCOPES.JOB_REPORT,
    }), (error) => {
      assert.equal(error.code, 'revoked_token');
      return true;
    });

    const short = await storeA.issueToken({
      scope: TOKEN_SCOPES.LAUNCH,
      sessionId: 'sess_redis_expiry_123',
      hpc: 'test-sshd',
      ttlMs: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await assert.rejects(() => storeB.validateToken(short.token, {
      scope: TOKEN_SCOPES.LAUNCH,
    }), (error) => {
      assert.equal(error.code, 'expired_token');
      return true;
    });

    const badHealth = createTokenStore({
      mode: 'redis',
      tokenStoreUrl: 'redis://127.0.0.1:1/0',
      redisKeyPrefix: `${prefix}_bad`,
      redisConnectTimeoutMs: 100,
      redisCommandTimeoutMs: 100,
    });
    const badHealthResult = await badHealth.healthCheck();
    assert.equal(badHealthResult.ok, false);
    await badHealth.close?.();
  } finally {
    await storeA.close?.();
    await storeB.close?.();
  }
} finally {
  await cleanupRedis(redisUrl).catch(() => {});
  await stopDocker().catch(() => {});
}

console.log('redis token store tests OK');
