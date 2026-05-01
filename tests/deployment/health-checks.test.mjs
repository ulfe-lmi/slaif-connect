import assert from 'node:assert/strict';
import {buildHealthz, evaluateReadiness} from '../../server/health/health_checks.js';
import {loadDeploymentConfig} from '../../server/config/deployment_config.js';
import {createTokenStore} from '../../server/tokens/token_store.js';
import {createRateLimiter} from '../../server/rate_limit/rate_limiter.js';
import {createAuditLogger} from '../../server/logging/audit_log.js';
import {createMemoryAuditSink} from '../../server/logging/audit_sink.js';
import {createMetricsRegistry} from '../../server/metrics/metrics_registry.js';

const health = buildHealthz({clock: () => new Date('2026-04-30T12:00:00.000Z')});
assert.deepEqual(health, {
  ok: true,
  status: 'alive',
  timestamp: '2026-04-30T12:00:00.000Z',
});

const config = loadDeploymentConfig({
  env: {
    SLAIF_ENV: 'development',
    SLAIF_API_BASE_URL: 'http://127.0.0.1:3000',
    SLAIF_RELAY_PUBLIC_URL: 'ws://127.0.0.1:3001/ssh-relay',
    SLAIF_ALLOWED_WEB_ORIGINS: 'http://127.0.0.1:3000',
    SLAIF_TOKEN_STORE: 'memory',
    SLAIF_AUDIT_LOG_MODE: 'stdout',
    SLAIF_RATE_LIMIT_MODE: 'memory',
    SLAIF_POLICY_TRUST_ROOTS_FILE: 'build/extension/config/policy_trust_roots.local.json',
    SLAIF_SIGNED_POLICY_FILE: 'build/extension/config/hpc_policy.local.json',
  },
});

const logs = [];
const auditSink = createMemoryAuditSink();
const metricsRegistry = createMetricsRegistry({environment: 'test'});
const ready = await evaluateReadiness({
  deploymentConfig: config,
  tokenStore: createTokenStore({mode: 'memory'}),
  rateLimiter: createRateLimiter({mode: 'memory'}),
  relayAllowlist: {'test-sshd': {host: '127.0.0.1', port: 22}},
  auditLogger: createAuditLogger({logger: {info: (line) => logs.push(line)}}),
  auditSink,
  metricsRegistry,
  requireSignedPolicy: true,
  requireTrustRoots: true,
});
assert.equal(ready.ok, true);
assert.equal(ready.checks.every((check) => check.ok), true);

const notReady = await evaluateReadiness({
  deploymentConfig: {...config, signedPolicyFile: undefined},
  tokenStore: createTokenStore({mode: 'memory'}),
  rateLimiter: createRateLimiter({mode: 'memory'}),
  relayAllowlist: {},
  auditLogger: null,
  metricsRegistry,
  requireSignedPolicy: true,
});
assert.equal(notReady.ok, false);
assert(notReady.checks.some((check) => check.name === 'relay_allowlist' && !check.ok));
assert(notReady.checks.some((check) => check.errorCode === 'signed_policy_missing'));
assert.equal(JSON.stringify(notReady).includes('secret-token-value'), false);

const unhealthyAudit = await evaluateReadiness({
  deploymentConfig: config,
  tokenStore: createTokenStore({mode: 'memory'}),
  rateLimiter: createRateLimiter({mode: 'memory'}),
  relayAllowlist: {'test-sshd': {host: '127.0.0.1', port: 22}},
  auditSink: {healthCheck: () => ({ok: false, errorCode: 'audit_sink_down'})},
  metricsRegistry,
});
assert.equal(unhealthyAudit.ok, false);
assert(unhealthyAudit.checks.some((check) => check.errorCode === 'audit_sink_down'));

const unhealthyMetrics = await evaluateReadiness({
  deploymentConfig: config,
  tokenStore: createTokenStore({mode: 'memory'}),
  rateLimiter: createRateLimiter({mode: 'memory'}),
  relayAllowlist: {'test-sshd': {host: '127.0.0.1', port: 22}},
  auditLogger: createAuditLogger({sink: auditSink}),
  metricsRegistry: {healthCheck: () => ({ok: false, errorCode: 'metrics_down'})},
});
assert.equal(unhealthyMetrics.ok, false);
assert(unhealthyMetrics.checks.some((check) => check.errorCode === 'metrics_down'));

console.log('health checks tests OK');
