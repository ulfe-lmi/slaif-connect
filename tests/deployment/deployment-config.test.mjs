import assert from 'node:assert/strict';
import {
  DeploymentConfigError,
  getSafeDeploymentSummary,
  loadDeploymentConfig,
} from '../../server/config/deployment_config.js';

function assertConfigError(env, code) {
  assert.throws(() => loadDeploymentConfig({env}), (error) => {
    assert(error instanceof DeploymentConfigError);
    assert.equal(error.code, code);
    return true;
  });
}

const validDevelopment = loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'development',
    SLAIF_API_BASE_URL: 'http://127.0.0.1:3000',
    SLAIF_RELAY_PUBLIC_URL: 'ws://127.0.0.1:3001/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'http://127.0.0.1:3000',
    SLAIF_TOKEN_STORE: 'memory',
    SLAIF_RATE_LIMIT_MODE: 'disabled',
    SLAIF_AUDIT_LOG_MODE: 'stdout',
  },
});
assert.equal(validDevelopment.env, 'development');
assert.equal(validDevelopment.tokenStore, 'memory');
assert.equal(validDevelopment.rateLimitMode, 'disabled');

const validProduction = loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'production',
    SLAIF_API_BASE_URL: 'https://connect.slaif.si',
    SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si,https://stare.lmi.link',
    SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'config/relay-targets.production.json',
    SLAIF_TOKEN_STORE: 'redis',
    SLAIF_TOKEN_STORE_URL: 'redis://token-store.internal:6379/0',
    SLAIF_AUDIT_LOG_MODE: 'external',
    SLAIF_RATE_LIMIT_MODE: 'external',
    SLAIF_POLICY_TRUST_ROOTS_FILE: '/etc/slaif/policy-trust-roots.json',
    SLAIF_SIGNED_POLICY_FILE: '/etc/slaif/hpc-policy.signed.json',
  },
});
assert.equal(validProduction.env, 'production');
assert.equal(validProduction.tokenStore, 'redis');
assert.equal(validProduction.rateLimitMode, 'external');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'http://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'unsafe_apiBaseUrl_protocol');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'ws://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'unsafe_relayPublicUrl_protocol');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://*.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'wildcard_allowedWebOrigin');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'memory',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'memory_token_store_not_allowed');

const singleInstancePilot = loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'production',
    SLAIF_API_BASE_URL: 'https://connect.slaif.si',
    SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
    SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
    SLAIF_TOKEN_STORE: 'memory',
    SLAIF_AUDIT_LOG_MODE: 'external',
    SLAIF_RATE_LIMIT_MODE: 'external',
    SLAIF_ALLOW_SINGLE_INSTANCE_PILOT: '1',
  },
});
assert.equal(singleInstancePilot.allowSingleInstancePilot, true);

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'missing_token_store_url');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'disabled',
}, 'rate_limit_disabled');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'disabled',
  SLAIF_RATE_LIMIT_MODE: 'external',
}, 'audit_log_disabled');

assertConfigError({
  SLAIF_ENV: 'production',
  SLAIF_API_BASE_URL: 'https://connect.slaif.si',
  SLAIF_RELAY_PUBLIC_URL: 'wss://connect.slaif.si/ssh-relay',
  SLAIF_ALLOWED_WEB_ORIGINS: 'https://connect.slaif.si',
  SLAIF_ALLOWED_RELAY_TARGETS_FILE: 'targets.json',
  SLAIF_TOKEN_STORE: 'redis',
  SLAIF_TOKEN_STORE_URL: 'redis://token-store',
  SLAIF_AUDIT_LOG_MODE: 'external',
  SLAIF_RATE_LIMIT_MODE: 'external',
  SLAIF_RELAY_MAX_AUTH_BYTES: '1000000',
}, 'unsafe_relayMaxAuthBytes');

const summary = getSafeDeploymentSummary({
  ...validProduction,
  tokenStoreUrl: 'redis://:secret-token-store-password@token-store.internal:6379/0',
});
const serializedSummary = JSON.stringify(summary);
assert.equal(serializedSummary.includes('secret-token-store-password'), false);
assert.equal(summary.apiOrigin, 'https://connect.slaif.si');

console.log('deployment config tests OK');
