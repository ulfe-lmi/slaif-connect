import assert from 'node:assert/strict';
import http from 'node:http';
import {createMemoryAuditSink} from '../../server/logging/audit_sink.js';
import {createAuditLogger} from '../../server/logging/audit_log.js';
import {createMetricsRegistry} from '../../server/metrics/metrics_registry.js';
import {createObservabilityHttpHandler} from '../../server/observability/observability_http.js';
import {createTokenStore} from '../../server/tokens/token_store.js';
import {createRateLimiter} from '../../server/rate_limit/rate_limiter.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: await response.json(),
  };
}

const auditSink = createMemoryAuditSink();
const auditLogger = createAuditLogger({sink: auditSink, environment: 'test'});
const metricsRegistry = createMetricsRegistry({environment: 'test'});
metricsRegistry.increment('slaif_job_reports_total', {route: 'job_report', outcome: 'accepted'});

const handler = createObservabilityHttpHandler({
  metricsRegistry,
  readinessOptions: {
    deploymentConfig: {
      env: 'test',
      auditLogMode: 'memory',
      metricsMode: 'prometheus',
    },
    tokenStore: createTokenStore({mode: 'memory'}),
    rateLimiter: createRateLimiter({mode: 'memory'}),
    relayAllowlist: {'test-sshd': {host: '127.0.0.1', port: 22}},
    auditLogger,
    auditSink,
  },
});

const server = http.createServer(async (req, res) => {
  if (await handler(req, res)) {
    return;
  }
  res.writeHead(404);
  res.end();
});
await listen(server);
try {
  const port = server.address().port;
  const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  const metricsText = await metrics.text();
  assert.equal(metrics.status, 200);
  assert.match(metricsText, /slaif_job_reports_total/);
  assert.equal(metricsText.includes('slaif_tok_secret'), false);

  const health = await getJson(port, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.status, 'alive');

  const ready = await getJson(port, '/readyz');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ok, true);

  const notReadyHandler = createObservabilityHttpHandler({
    metricsRegistry: {healthCheck: () => ({ok: false, errorCode: 'metrics_down'})},
    readinessOptions: {
      deploymentConfig: {env: 'test', auditLogMode: 'memory'},
      tokenStore: createTokenStore({mode: 'memory'}),
      rateLimiter: createRateLimiter({mode: 'memory'}),
      relayAllowlist: {},
      auditLogger,
      auditSink,
    },
  });
  const notReadyServer = http.createServer((req, res) => notReadyHandler(req, res));
  await listen(notReadyServer);
  try {
    const notReady = await getJson(notReadyServer.address().port, '/readyz');
    assert.equal(notReady.status, 503);
    assert.equal(notReady.body.ok, false);
    assert.equal(JSON.stringify(notReady.body).includes('secret'), false);
  } finally {
    await close(notReadyServer);
  }
} finally {
  await close(server);
}

console.log('observability HTTP tests OK');
