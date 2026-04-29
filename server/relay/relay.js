import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.PORT || 8080);
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_HOSTS_FILE = process.env.SLAIF_RELAY_HOSTS_FILE ||
    join(__dirname, 'allowed_hpc_hosts.json');
const EXAMPLE_HOSTS_FILE = join(__dirname, 'allowed_hpc_hosts.example.json');
const TOKEN_TTL_MS = Number(process.env.SLAIF_RELAY_TOKEN_TTL_MS || 5 * 60 * 1000);
const DEMO = process.env.SLAIF_RELAY_DEMO === '1';

export function loadAllowedHosts(filePath = DEFAULT_HOSTS_FILE) {
  const path = fs.existsSync(filePath) ? filePath : EXAMPLE_HOSTS_FILE;
  const text = fs.readFileSync(path, 'utf8');
  const parsed = JSON.parse(text);
  const hosts = parsed.hosts || parsed;
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) {
    throw new Error(`${path} must contain {"hosts": {...}} or an alias object`);
  }
  return hosts;
}

export function validateAlias(alias) {
  return typeof alias === 'string' && /^[a-z0-9_-]{1,64}$/i.test(alias);
}

function normalizeAlias(alias) {
  return validateAlias(alias) ? alias.toLowerCase() : null;
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch (_e) {
    // Ignore close races.
  }
}

export async function resolveRelayToken(relayToken, options = {}) {
  const {
    devMode = DEMO,
    devTokenMap = {},
    tokenResolver = null,
    tokenTtlMs = TOKEN_TTL_MS,
  } = options;

  if (typeof relayToken !== 'string' || relayToken.length < 8) {
    return null;
  }

  if (tokenResolver) {
    return tokenResolver(relayToken);
  }

  if (devMode) {
    if (devTokenMap[relayToken]) {
      const entry = devTokenMap[relayToken];
      const hpc = normalizeAlias(entry.hpc || entry.alias);
      if (!hpc) {
        return null;
      }
      return {
        sessionId: entry.sessionId || 'sess_dev_token',
        userId: entry.userId || 'dev-user',
        hpc,
        expiresAt: entry.expiresAt || Date.now() + tokenTtlMs,
      };
    }

    if (relayToken === 'dev-token-test-sshd') {
      return {
        sessionId: 'sess_dev_test_sshd',
        userId: 'dev-user',
        hpc: 'test-sshd',
        expiresAt: Date.now() + tokenTtlMs,
      };
    }

    // Local-only demo format:
    //   demo:<hpc-alias>:<session-id>
    const parts = relayToken.split(':');
    if (parts.length === 3 && parts[0] === 'demo') {
      const hpc = normalizeAlias(parts[1]);
      if (hpc) {
        return {
          userId: 'demo-user',
          hpc,
          sessionId: parts[2],
          expiresAt: Date.now() + tokenTtlMs,
        };
      }
    }
  }

  // TODO production:
  // Look up a short-lived, single-use, server-issued token in the SLAIF session
  // store. The token must map server-side to user/session/HPC alias and must
  // never contain a client-supplied raw host or port.
  return null;
}

function targetForSession(session, allowedHosts) {
  const alias = normalizeAlias(session?.hpc);
  if (!alias) {
    return null;
  }

  const target = allowedHosts[alias];
  if (!target) {
    return null;
  }

  if (typeof target.host !== 'string' || !Number.isInteger(target.port)) {
    throw new Error(`invalid configured target for ${alias}`);
  }

  return {
    alias,
    host: target.host,
    port: target.port,
  };
}

function defaultConnectTcp(target, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host: target.host, port: target.port});
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('tcp connect timeout'));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export function createRelayServer(options = {}) {
  const {
    allowedHosts = loadAllowedHosts(),
    path = '/ssh-relay',
    logger = console,
    connectTcp = defaultConnectTcp,
    tokenOptions = {},
  } = options;

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('ok\n');
      return;
    }
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('not found\n');
  });

  const wss = new WebSocketServer({server, path});

  wss.on('connection', (ws, req) => {
    let authed = false;
    let tcp = null;
    let session = null;
    let target = null;

    ws.on('message', async (message, isBinary) => {
      try {
        if (!authed) {
          if (isBinary) {
            safeClose(ws, 1008, 'auth_required');
            return;
          }

          let auth;
          try {
            auth = JSON.parse(message.toString('utf8'));
          } catch (_e) {
            safeClose(ws, 1008, 'bad_auth_json');
            return;
          }

          if (!auth || auth.type !== 'auth') {
            safeClose(ws, 1008, 'bad_auth_type');
            return;
          }

          if ('host' in auth || 'port' in auth || 'target' in auth) {
            safeClose(ws, 1008, 'client_target_not_allowed');
            return;
          }

          session = await resolveRelayToken(auth.relayToken, tokenOptions);
          if (!session || session.expiresAt < Date.now()) {
            safeClose(ws, 1008, 'invalid_or_expired_token');
            return;
          }

          target = targetForSession(session, allowedHosts);
          if (!target) {
            safeClose(ws, 1008, 'target_not_allowed');
            return;
          }

          tcp = await connectTcp(target);

          tcp.on('data', (chunk) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(chunk, {binary: true});
            }
          });

          tcp.on('close', () => {
            safeClose(ws, 1000, 'tcp_closed');
          });

          tcp.on('error', () => {
            safeClose(ws, 1011, 'tcp_error');
          });

          authed = true;
          ws.send(JSON.stringify({type: 'ok'}));

          logger.info?.(`relay connected session=${session.sessionId} hpc=${target.alias} target=${target.host}:${target.port} origin=${req.headers.origin || '-'}`);
          return;
        }

        if (!isBinary) {
          safeClose(ws, 1003, 'binary_required');
          return;
        }

        if (!tcp || tcp.destroyed) {
          safeClose(ws, 1011, 'tcp_not_connected');
          return;
        }

        // SSH payload bytes are opaque to the relay and must never be logged.
        tcp.write(Buffer.from(message));
      } catch (error) {
        logger.error?.(`relay error: ${error.message}`);
        safeClose(ws, 1011, 'relay_error');
      }
    });

    ws.on('close', () => {
      if (tcp && !tcp.destroyed) {
        tcp.destroy();
      }
    });
  });

  return {
    server,
    wss,
    listen({host = DEFAULT_HOST, port = DEFAULT_PORT} = {}) {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(this);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    address() {
      return server.address();
    },
    close() {
      for (const client of wss.clients) {
        safeClose(client, 1001, 'server_close');
      }
      return new Promise((resolve, reject) => {
        wss.close((wssError) => {
          server.close((serverError) => {
            const error = wssError || serverError;
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

async function main() {
  const allowedHosts = loadAllowedHosts();
  const relay = createRelayServer({
    allowedHosts,
    tokenOptions: {
      devMode: DEMO,
    },
  });

  await relay.listen({host: DEFAULT_HOST, port: DEFAULT_PORT});
  const address = relay.address();
  console.log(`SLAIF relay listening on http://${address.address}:${address.port}/ssh-relay`);
  if (DEMO) {
    console.log('DEMO mode enabled. Example relay token: demo:vegahpc:sess_abcdefgh');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
