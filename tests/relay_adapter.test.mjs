import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket, WebSocketServer} from 'ws';
import {SlaifRelay, SlaifRelayStream} from '../extension/js/slaif_relay.js';

async function startWsServer(onConnection) {
  const wss = new WebSocketServer({host: '127.0.0.1', port: 0});
  const clients = new Set();
  await once(wss, 'listening');
  wss.on('connection', (ws, req) => {
    clients.add(ws);
    ws.once('close', () => clients.delete(ws));
    onConnection(ws, req);
  });
  return {
    url: `ws://127.0.0.1:${wss.address().port}/ssh-relay`,
    close: () => new Promise((resolve) => {
      for (const client of clients) {
        client.close();
      }
      wss.close(resolve);
    }),
  };
}

async function testWaitsForAuthOkBeforeForwarding() {
  const receivedBinary = [];
  const server = await startWsServer((ws) => {
    ws.once('message', (message, isBinary) => {
      assert.equal(isBinary, false);
      assert.equal(JSON.parse(message.toString()).relayToken, 'dev-token');
      setTimeout(() => ws.send(JSON.stringify({type: 'ok'})), 50);
    });
    ws.on('message', (message, isBinary) => {
      if (isBinary) {
        receivedBinary.push(Buffer.from(message));
      }
    });
  });

  try {
    const stream = new SlaifRelayStream({
      relayUrl: server.url,
      relayToken: 'dev-token',
      WebSocketImpl: WebSocket,
    });
    const openPromise = stream.open();
    const writePromise = stream.write(new Uint8Array([1, 2, 3]));
    assert.equal(receivedBinary.length, 0);
    await openPromise;
    await writePromise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receivedBinary.length, 1);
    assert.deepEqual([...receivedBinary[0]], [1, 2, 3]);
    stream.close();
  } finally {
    await server.close();
  }
}

async function testInvalidAuthResponseFails() {
  const server = await startWsServer((ws) => {
    ws.once('message', () => ws.send(JSON.stringify({type: 'error'})));
  });
  try {
    const stream = new SlaifRelayStream({
      relayUrl: server.url,
      relayToken: 'dev-token',
      WebSocketImpl: WebSocket,
    });
    await assert.rejects(() => stream.open(), /relay auth failed/);
  } finally {
    await server.close();
  }
}

async function testTargetMismatchRejected() {
  const relay = new SlaifRelay({
    policyHost: {
      sshHost: 'login.example',
      sshPort: 22,
    },
    relayUrl: 'ws://127.0.0.1:1/ssh-relay',
    relayToken: 'dev-token',
    WebSocketImpl: WebSocket,
    logger: {error() {}},
  });

  assert.equal(await relay.openSocket('attacker.example', 22), null);
  assert.equal(await relay.openSocket('login.example', 2222), null);
}

async function testClosePropagates() {
  const server = await startWsServer((ws) => {
    ws.once('message', () => ws.send(JSON.stringify({type: 'ok'})));
    setTimeout(() => ws.close(1000, 'done'), 50);
  });
  try {
    const stream = new SlaifRelayStream({
      relayUrl: server.url,
      relayToken: 'dev-token',
      WebSocketImpl: WebSocket,
    });
    const closed = new Promise((resolve) => {
      stream.onClose = resolve;
    });
    await stream.open();
    await closed;
  } finally {
    await server.close();
  }
}

await testWaitsForAuthOkBeforeForwarding();
await testInvalidAuthResponseFails();
await testTargetMismatchRejected();
await testClosePropagates();

console.log('relay adapter tests OK');
