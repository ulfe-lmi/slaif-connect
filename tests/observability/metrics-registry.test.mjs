import assert from 'node:assert/strict';
import {
  MetricsError,
  createMetricsRegistry,
} from '../../server/metrics/metrics_registry.js';

const registry = createMetricsRegistry({environment: 'test'});
registry.increment('slaif_tokens_issued_total', {
  scope: 'slaif.relay',
  outcome: 'issued',
  tokenStoreType: 'memory',
});
registry.increment('slaif_tokens_consumed_total', {
  scope: 'slaif.relay',
  outcome: 'accepted',
  tokenStoreType: 'memory',
}, 2);
registry.setGauge('slaif_relay_active_connections', {}, 1);
registry.observeHistogram('slaif_relay_connection_duration_seconds', {}, 1.25);

const text = registry.renderPrometheus();
assert.match(text, /slaif_tokens_issued_total/);
assert.match(text, /slaif_tokens_consumed_total/);
assert.match(text, /slaif_relay_active_connections/);
assert.match(text, /slaif_relay_connection_duration_seconds_count/);
assert.equal(text.includes('slaif_tok_secret'), false);

for (const label of [
  'token',
  'launchToken',
  'relayToken',
  'jobReportToken',
  'tokenFingerprint',
  'sessionId',
  'password',
  'otp',
  'privateKey',
  'transcript',
  'stdout',
  'stderr',
]) {
  assert.throws(() => registry.increment('slaif_tokens_rejected_total', {
    [label]: 'sample',
  }), (error) => {
    assert(error instanceof MetricsError);
    assert.equal(error.code, 'forbidden_metric_label');
    return true;
  });
}

for (const value of [
  'slaif_tok_full_token_value',
  'password=secret',
  'OTP 123456',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'Submitted batch job 424242',
]) {
  assert.throws(() => registry.increment('slaif_tokens_rejected_total', {
    reason: value,
  }), (error) => {
    assert(error instanceof MetricsError);
    assert.equal(error.code, 'forbidden_metric_label_value');
    return true;
  });
}

assert.equal(registry.healthCheck().ok, true);
registry.reset();
assert.equal(registry._samples().counters.length, 0);

console.log('metrics registry tests OK');
