import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createMemoryAuditSink} from '../../server/logging/audit_sink.js';
import {createAuditLogger} from '../../server/logging/audit_log.js';
import {createMetricsRegistry} from '../../server/metrics/metrics_registry.js';
import {createRelayServer} from '../../server/relay/relay.js';
import {createTokenRegistry, TOKEN_SCOPES} from '../../server/tokens/token_registry.js';
import {evaluateReadiness} from '../../server/health/health_checks.js';
import {createRateLimiter} from '../../server/rate_limit/rate_limiter.js';

async function startTcpSink() {
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      socket.write(Buffer.from('SSH_PAYLOAD_REPLY_MUST_NOT_BE_LOGGED'));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function connectWs(relay) {
  return new WebSocket(`ws://127.0.0.1:${relay.address().port}/ssh-relay`, ['slaif-ssh-relay-v1']);
}

async function waitOpen(ws) {
  if (ws.readyState !== WebSocket.OPEN) {
    await once(ws, 'open');
  }
}

const auditSink = createMemoryAuditSink();
const auditLogger = createAuditLogger({sink: auditSink, environment: 'test'});
const metricsRegistry = createMetricsRegistry({environment: 'test'});
const tokenRegistry = createTokenRegistry({auditLogger, metricsRegistry});
const hpc = 'test-sshd';
const sessionId = 'sess_observability_integration_123';

const launch = tokenRegistry.issueToken({
  scope: TOKEN_SCOPES.LAUNCH,
  sessionId,
  hpc,
  ttlMs: 60000,
  maxUses: 1,
});
const relayToken = tokenRegistry.issueToken({
  scope: TOKEN_SCOPES.RELAY,
  sessionId,
  hpc,
  ttlMs: 60000,
  maxUses: 1,
});
const job = tokenRegistry.issueToken({
  scope: TOKEN_SCOPES.JOB_REPORT,
  sessionId,
  hpc,
  ttlMs: 60000,
  maxUses: 1,
});

auditLogger.event('descriptor.requested', {sessionId, hpc, outcome: 'started'});
metricsRegistry.increment('slaif_descriptor_requests_total', {
  route: 'session_descriptor',
  outcome: 'requested',
});
tokenRegistry.consumeToken(launch.token, {scope: TOKEN_SCOPES.LAUNCH, sessionId, hpc});
auditLogger.event('descriptor.issued', {sessionId, hpc, outcome: 'issued'});

const tcp = await startTcpSink();
const relay = createRelayServer({
  allowedHosts: {
    [hpc]: {host: '127.0.0.1', port: tcp.port},
  },
  tokenOptions: {
    devMode: false,
    tokenRegistry,
  },
  auditLogger,
  metricsRegistry,
  unauthenticatedTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  maxConnectionMs: 2000,
});
await relay.listen({host: '127.0.0.1', port: 0});
try {
  const ws = connectWs(relay);
  await waitOpen(ws);
  ws.send(JSON.stringify({type: 'auth', relayToken: relayToken.token}));
  const [message] = await once(ws, 'message');
  assert.deepEqual(JSON.parse(message.toString()), {type: 'ok'});
  ws.send(Buffer.from('SSH_PAYLOAD_MUST_NOT_BE_LOGGED'));
  await once(ws, 'message');
  ws.close();
  await once(ws, 'close');

  auditLogger.event('jobReport.received', {sessionId, hpc, outcome: 'received'});
  tokenRegistry.consumeToken(job.token, {scope: TOKEN_SCOPES.JOB_REPORT, sessionId, hpc});
  auditLogger.event('jobReport.accepted', {sessionId, hpc, outcome: 'accepted'});
  metricsRegistry.increment('slaif_job_reports_total', {
    route: 'job_report',
    outcome: 'accepted',
    scheduler: 'slurm',
  });

  const eventsText = JSON.stringify(auditSink.events);
  const metricsText = metricsRegistry.renderPrometheus();
  for (const secret of [
    launch.token,
    relayToken.token,
    job.token,
    'SSH_PAYLOAD_MUST_NOT_BE_LOGGED',
    'SSH_PAYLOAD_REPLY_MUST_NOT_BE_LOGGED',
  ]) {
    assert.equal(eventsText.includes(secret), false);
    assert.equal(metricsText.includes(secret), false);
  }
  for (const eventName of [
    'descriptor.issued',
    'relay.auth.accepted',
    'relay.closed',
    'jobReport.accepted',
    'token.consumed',
  ]) {
    assert(auditSink.events.some((event) => event.event === eventName), eventName);
  }
  assert.match(metricsText, /slaif_tokens_consumed_total/);
  assert.match(metricsText, /slaif_relay_connections_total/);
  assert.match(metricsText, /slaif_job_reports_total/);

  const readiness = await evaluateReadiness({
    deploymentConfig: {env: 'test', auditLogMode: 'memory', metricsMode: 'prometheus'},
    tokenStore: {healthCheck: () => ({ok: true, mode: 'memory'})},
    rateLimiter: createRateLimiter({mode: 'memory'}),
    relayAllowlist: {[hpc]: {host: '127.0.0.1', port: tcp.port}},
    auditLogger,
    auditSink,
    metricsRegistry,
  });
  assert.equal(readiness.ok, true);
} finally {
  await relay.close();
  await tcp.close();
}

console.log('observability integration tests OK');
