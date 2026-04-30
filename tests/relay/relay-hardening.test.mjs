import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelayServer} from '../../server/relay/relay.js';
import {createTokenRegistry, TOKEN_SCOPES} from '../../server/tokens/token_registry.js';

async function startTcpSink({echo = false} = {}) {
  const payloads = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      payloads.push(Buffer.from(chunk));
      if (echo) {
        socket.write(chunk);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    payloads,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function makeLogger() {
  const events = [];
  return {
    events,
    info(line) {
      try {
        events.push(JSON.parse(line));
      } catch (_error) {
        events.push({raw: line});
      }
    },
    error(line) {
      this.info(line);
    },
  };
}

function issueRelayToken(registry, overrides = {}) {
  return registry.issueToken({
    scope: TOKEN_SCOPES.RELAY,
    sessionId: 'sess_relay_hardening_123',
    hpc: 'test-sshd',
    ttlMs: 60000,
    maxUses: 1,
    ...overrides,
  }).token;
}

async function startRelay({registry, tcpPort, logger, options = {}} = {}) {
  const relay = createRelayServer({
    allowedHosts: {
      'test-sshd': {
        host: '127.0.0.1',
        port: tcpPort || 9,
      },
    },
    logger,
    tokenOptions: {
      devMode: false,
      tokenRegistry: registry,
    },
    unauthenticatedTimeoutMs: 60,
    idleTimeoutMs: 80,
    maxConnectionMs: 120,
    ...options,
  });
  await relay.listen({host: '127.0.0.1', port: 0});
  return relay;
}

function connectWs(relay) {
  return new WebSocket(`ws://127.0.0.1:${relay.address().port}/ssh-relay`, ['slaif-ssh-relay-v1']);
}

async function waitOpen(ws) {
  if (ws.readyState !== WebSocket.OPEN) {
    await once(ws, 'open');
  }
}

async function waitClose(ws) {
  const [code, reason] = await once(ws, 'close');
  return {code, reason: reason.toString()};
}

async function waitJson(ws) {
  const [message, isBinary] = await once(ws, 'message');
  assert.equal(isBinary, false);
  return JSON.parse(message.toString('utf8'));
}

async function testUnauthenticatedConnectionTimesOut() {
  const logger = makeLogger();
  const registry = createTokenRegistry();
  const relay = await startRelay({registry, logger});
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    const close = await waitClose(ws);
    assert.equal(close.reason, 'auth_timeout');
    assert(logger.events.some((event) => event.type === 'relay.auth_timeout'));
  } finally {
    await relay.close();
  }
}

async function testOversizedAuthRejected() {
  const logger = makeLogger();
  const registry = createTokenRegistry();
  const relay = await startRelay({
    registry,
    logger,
    options: {maxAuthMessageBytes: 16},
  });
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(JSON.stringify({type: 'auth', relayToken: 'x'.repeat(64)}));
    const close = await waitClose(ws);
    assert.equal(close.reason, 'auth_message_too_large');
  } finally {
    await relay.close();
  }
}

async function testInvalidWrongScopeExpiredAndClientTargetRejected() {
  let currentTime = Date.now();
  const registry = createTokenRegistry({clock: () => currentTime});
  const tcp = await startTcpSink();
  const logger = makeLogger();
  const relay = await startRelay({registry, tcpPort: tcp.port, logger});
  try {
    const invalid = connectWs(relay);
    await waitOpen(invalid);
    invalid.send(JSON.stringify({type: 'auth', relayToken: 'slaif_tok_unknown_token_value'}));
    assert.equal((await waitClose(invalid)).reason, 'unknown_token');

    const wrongScopeToken = registry.issueToken({
      scope: TOKEN_SCOPES.LAUNCH,
      sessionId: 'sess_relay_hardening_123',
      hpc: 'test-sshd',
      ttlMs: 60000,
      maxUses: 1,
    }).token;
    const wrongScope = connectWs(relay);
    await waitOpen(wrongScope);
    wrongScope.send(JSON.stringify({type: 'auth', relayToken: wrongScopeToken}));
    assert.equal((await waitClose(wrongScope)).reason, 'wrong_scope');

    const expiredToken = issueRelayToken(registry, {ttlMs: 10});
    currentTime += 20;
    const expired = connectWs(relay);
    await waitOpen(expired);
    expired.send(JSON.stringify({type: 'auth', relayToken: expiredToken}));
    assert.equal((await waitClose(expired)).reason, 'expired_token');

    const clientTarget = connectWs(relay);
    await waitOpen(clientTarget);
    clientTarget.send(JSON.stringify({
      type: 'auth',
      relayToken: issueRelayToken(registry, {ttlMs: 60000}),
      host: 'attacker.example',
      port: 22,
    }));
    assert.equal((await waitClose(clientTarget)).reason, 'client_target_not_allowed');

    const aliasMismatchToken = registry.issueToken({
      scope: TOKEN_SCOPES.RELAY,
      sessionId: 'sess_relay_hardening_123',
      hpc: 'otherhpc',
      ttlMs: 60000,
      maxUses: 1,
    }).token;
    const aliasMismatch = connectWs(relay);
    await waitOpen(aliasMismatch);
    aliasMismatch.send(JSON.stringify({type: 'auth', relayToken: aliasMismatchToken}));
    assert.equal((await waitClose(aliasMismatch)).reason, 'target_not_allowed');
  } finally {
    await relay.close();
    await tcp.close();
  }
}

async function testBinaryBeforeAuthAndMissingAllowlistRejected() {
  const registry = createTokenRegistry();
  const logger = makeLogger();
  const relay = createRelayServer({
    allowedHosts: {},
    logger,
    tokenOptions: {devMode: false, tokenRegistry: registry},
    unauthenticatedTimeoutMs: 1000,
  });
  await relay.listen({host: '127.0.0.1', port: 0});
  try {
    const binary = connectWs(relay);
    await waitOpen(binary);
    binary.send(Buffer.from([1, 2, 3]));
    assert.equal((await waitClose(binary)).reason, 'auth_required');

    const missing = connectWs(relay);
    await waitOpen(missing);
    missing.send(JSON.stringify({type: 'auth', relayToken: issueRelayToken(registry)}));
    assert.equal((await waitClose(missing)).reason, 'target_not_allowed');
  } finally {
    await relay.close();
  }
}

async function testReplayIdleLifetimeAndPayloadLogging() {
  const registry = createTokenRegistry();
  const tcp = await startTcpSink({echo: true});
  const logger = makeLogger();
  const relay = await startRelay({registry, tcpPort: tcp.port, logger});
  try {
    const token = issueRelayToken(registry);
    const first = connectWs(relay);
    await waitOpen(first);
    first.send(JSON.stringify({type: 'auth', relayToken: token}));
    assert.deepEqual(await waitJson(first), {type: 'ok'});
    const secretPayload = 'SSH_SECRET_PAYLOAD_MUST_NOT_BE_LOGGED';
    first.send(Buffer.from(secretPayload));
    const [echo] = await once(first, 'message');
    assert.equal(Buffer.from(echo).toString(), secretPayload);

    const replay = connectWs(relay);
    await waitOpen(replay);
    replay.send(JSON.stringify({type: 'auth', relayToken: token}));
    assert.equal((await waitClose(replay)).reason, 'token_use_exceeded');

    const idleClose = await waitClose(first);
    assert.equal(idleClose.reason, 'idle_timeout');
    assert.equal(JSON.stringify(logger.events).includes(secretPayload), false);
  } finally {
    await relay.close();
    await tcp.close();
  }
}

async function testMaxLifetimeClosesConnection() {
  const registry = createTokenRegistry();
  const tcp = await startTcpSink();
  const logger = makeLogger();
  const relay = await startRelay({
    registry,
    tcpPort: tcp.port,
    logger,
    options: {
      idleTimeoutMs: 1000,
      maxConnectionMs: 60,
    },
  });
  try {
    const maxToken = issueRelayToken(registry);
    const max = connectWs(relay);
    await waitOpen(max);
    max.send(JSON.stringify({type: 'auth', relayToken: maxToken}));
    assert.deepEqual(await waitJson(max), {type: 'ok'});
    const maxClose = await waitClose(max);
    assert.equal(maxClose.reason, 'max_lifetime_exceeded');
  } finally {
    await relay.close();
    await tcp.close();
  }
}

await testUnauthenticatedConnectionTimesOut();
await testOversizedAuthRejected();
await testInvalidWrongScopeExpiredAndClientTargetRejected();
await testBinaryBeforeAuthAndMissingAllowlistRejected();
await testReplayIdleLifetimeAndPayloadLogging();
await testMaxLifetimeClosesConnection();

console.log('relay hardening tests OK');
