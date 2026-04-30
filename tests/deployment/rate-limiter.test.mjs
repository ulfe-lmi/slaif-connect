import assert from 'node:assert/strict';
import {
  createRateLimiter,
  RateLimitError,
  RateLimiterNotImplementedError,
} from '../../server/rate_limit/rate_limiter.js';
import {loadDeploymentConfig} from '../../server/config/deployment_config.js';

let now = Date.parse('2026-04-30T12:00:00.000Z');
const limiter = createRateLimiter({
  mode: 'memory',
  windowMs: 1000,
  max: 2,
}, {clock: () => now});

assert.equal(limiter.healthCheck().ok, true);
assert.equal(limiter.checkLimit({scope: 'descriptor', key: 'sess_1'}).ok, true);
assert.equal(limiter.consume({scope: 'descriptor', key: 'sess_1'}).remaining, 1);
assert.equal(limiter.consume({scope: 'descriptor', key: 'sess_1'}).remaining, 0);
assert.throws(() => limiter.consume({scope: 'descriptor', key: 'sess_1'}), (error) => {
  assert(error instanceof RateLimitError);
  assert.equal(error.code, 'rate_limit_exceeded');
  return true;
});

assert.equal(limiter.consume({scope: 'descriptor', key: 'sess_2'}).remaining, 1);
now += 1001;
assert.equal(limiter.consume({scope: 'descriptor', key: 'sess_1'}).remaining, 1);

const disabled = createRateLimiter({mode: 'disabled'});
assert.equal(disabled.consume({scope: 'dev', key: 'local'}).ok, true);

assert.throws(() => createRateLimiter({mode: 'external'}), (error) => {
  assert(error instanceof RateLimiterNotImplementedError);
  assert.equal(error.mode, 'external');
  return true;
});

const devConfig = loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'development',
    SLAIF_API_BASE_URL: 'http://127.0.0.1:3000',
    SLAIF_RELAY_PUBLIC_URL: 'ws://127.0.0.1:3001/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'http://127.0.0.1:3000',
    SLAIF_RATE_LIMIT_MODE: 'disabled',
  },
});
assert.equal(devConfig.rateLimitMode, 'disabled');

assert.throws(() => loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'production',
    SLAIF_API_BASE_URL: 'https://connect.slaif.si',
    SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
    SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
    SLAIF_TOKEN_STORE: 'redis',
    SLAIF_TOKEN_STORE_URL: 'redis://token-store',
    SLAIF_AUDIT_LOG_MODE: 'external',
    SLAIF_RATE_LIMIT_MODE: 'disabled',
  },
}), (error) => {
  assert.equal(error.code, 'rate_limit_disabled');
  return true;
});

console.log('rate limiter tests OK');
