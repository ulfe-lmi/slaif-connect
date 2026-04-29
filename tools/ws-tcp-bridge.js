#!/usr/bin/env node
import net from 'node:net';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {WebSocket} from 'ws';

function safeCloseTcp(socket) {
  if (!socket.destroyed) {
    socket.destroy();
  }
}

function safeCloseWs(ws, code = 1000, reason = 'bridge_close') {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(code, reason);
  }
}

export function startWsTcpBridge(options = {}) {
  const {
    host = '127.0.0.1',
    port = 0,
    relayUrl,
    relayToken,
    logger = console,
  } = options;

  if (!relayUrl) {
    throw new Error('relayUrl is required');
  }
  if (!relayToken) {
    throw new Error('relayToken is required');
  }

  const active = new Set();
  const server = net.createServer((tcp) => {
    tcp.pause();

    const ws = new WebSocket(relayUrl, ['slaif-ssh-relay-v1']);
    const connection = {tcp, ws};
    active.add(connection);

    let authed = false;
    let closed = false;

    const closeBoth = () => {
      if (closed) {
        return;
      }
      closed = true;
      active.delete(connection);
      safeCloseTcp(tcp);
      safeCloseWs(ws);
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        relayToken,
      }));
    });

    ws.on('message', (message, isBinary) => {
      if (!authed) {
        if (isBinary) {
          logger.error?.('relay auth failed: expected text response');
          closeBoth();
          return;
        }
        let response;
        try {
          response = JSON.parse(message.toString('utf8'));
        } catch (_e) {
          logger.error?.('relay auth failed: invalid JSON response');
          closeBoth();
          return;
        }
        if (response.type !== 'ok') {
          logger.error?.(`relay auth failed: ${message.toString('utf8')}`);
          closeBoth();
          return;
        }
        authed = true;
        tcp.resume();
        return;
      }

      if (!isBinary) {
        logger.error?.('relay sent unexpected text frame after auth');
        closeBoth();
        return;
      }

      // SSH payload bytes are opaque to this development bridge.
      tcp.write(Buffer.from(message));
    });

    tcp.on('data', (chunk) => {
      if (!authed || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      // Do not inspect or log SSH payload bytes.
      ws.send(chunk, {binary: true});
    });

    tcp.on('close', closeBoth);
    tcp.on('error', closeBoth);
    ws.on('close', closeBoth);
    ws.on('error', closeBoth);
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve({
        server,
        address() {
          return server.address();
        },
        close() {
          for (const {tcp, ws} of active) {
            safeCloseTcp(tcp);
            safeCloseWs(ws, 1001, 'bridge_stop');
          }
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function parseArgs(argv) {
  const out = {
    host: '127.0.0.1',
    port: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') {
      out.host = argv[++i];
    } else if (arg === '--port') {
      out.port = Number(argv[++i]);
    } else if (arg === '--relay-url') {
      out.relayUrl = argv[++i];
    } else if (arg === '--relay-token') {
      out.relayToken = argv[++i];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

async function main() {
  const bridge = await startWsTcpBridge(parseArgs(process.argv.slice(2)));
  const address = bridge.address();
  console.log(`SLAIF dev TCP-to-WebSocket bridge listening on ${address.address}:${address.port}`);
  console.log('Development only: this bridge is not part of the Chrome extension runtime.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
