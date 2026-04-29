import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelayServer} from '../../server/relay/relay.js';

const silentLogger = {
  info() {},
  error() {},
};

async function startTcpSink() {
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
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

async function startRelay({allowedHosts, devTokenMap} = {}) {
  const relay = createRelayServer({
    allowedHosts: allowedHosts || {},
    logger: silentLogger,
    tokenOptions: {
      devMode: true,
      devTokenMap: devTokenMap || {
        'dev-token-test-sshd': {
          hpc: 'test-sshd',
          sessionId: 'sess_relay_auth_test',
          userId: 'test-user',
        },
      },
    },
  });
  await relay.listen({host: '127.0.0.1', port: 0});
  return relay;
}

function connectWs(relay) {
  const {port} = relay.address();
  return new WebSocket(`ws://127.0.0.1:${port}/ssh-relay`, ['slaif-ssh-relay-v1']);
}

async function waitOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }
  await once(ws, 'open');
}

async function waitClose(ws) {
  const [code, reason] = await once(ws, 'close');
  return {
    code,
    reason: reason.toString(),
  };
}

async function waitJson(ws) {
  const [message, isBinary] = await once(ws, 'message');
  assert.equal(isBinary, false);
  return JSON.parse(message.toString('utf8'));
}

async function testBinaryBeforeAuthRejected() {
  const relay = await startRelay();
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(Buffer.from([0]));
    const close = await waitClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'auth_required');
  } finally {
    await relay.close();
  }
}

async function testInvalidTokenRejected() {
  const relay = await startRelay();
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(JSON.stringify({type: 'auth', relayToken: 'bad'}));
    const close = await waitClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'invalid_or_expired_token');
  } finally {
    await relay.close();
  }
}

async function testValidTokenMapsToServerSideAlias() {
  const tcp = await startTcpSink();
  const relay = await startRelay({
    allowedHosts: {
      'test-sshd': {
        host: '127.0.0.1',
        port: tcp.port,
      },
    },
  });
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(JSON.stringify({type: 'auth', relayToken: 'dev-token-test-sshd'}));
    assert.deepEqual(await waitJson(ws), {type: 'ok'});
    ws.close();
  } finally {
    await relay.close();
    await tcp.close();
  }
}

async function testClientSuppliedHostPortRejected() {
  const tcp = await startTcpSink();
  const relay = await startRelay({
    allowedHosts: {
      'test-sshd': {
        host: '127.0.0.1',
        port: tcp.port,
      },
    },
  });
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(JSON.stringify({
      type: 'auth',
      relayToken: 'dev-token-test-sshd',
      host: 'attacker.example',
      port: 22,
    }));
    const close = await waitClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'client_target_not_allowed');
  } finally {
    await relay.close();
    await tcp.close();
  }
}

async function testMissingAllowlistTargetRejected() {
  const relay = await startRelay({
    allowedHosts: {},
  });
  try {
    const ws = connectWs(relay);
    await waitOpen(ws);
    ws.send(JSON.stringify({type: 'auth', relayToken: 'dev-token-test-sshd'}));
    const close = await waitClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'target_not_allowed');
  } finally {
    await relay.close();
  }
}

await testBinaryBeforeAuthRejected();
await testInvalidTokenRejected();
await testValidTokenMapsToServerSideAlias();
await testClientSuppliedHostPortRejected();
await testMissingAllowlistTargetRejected();

console.log('relay auth/security tests OK');
