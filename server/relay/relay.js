import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';
import {createAuditLogger} from '../logging/audit_log.js';
import {TOKEN_SCOPES, TokenRegistryError} from '../tokens/token_registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.PORT || 8080);
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_HOSTS_FILE = process.env.SLAIF_RELAY_HOSTS_FILE ||
    join(__dirname, 'allowed_hpc_hosts.json');
const EXAMPLE_HOSTS_FILE = join(__dirname, 'allowed_hpc_hosts.example.json');
const TOKEN_TTL_MS = Number(process.env.SLAIF_RELAY_TOKEN_TTL_MS || 5 * 60 * 1000);
const DEMO = process.env.SLAIF_RELAY_DEMO === '1';
const DEFAULT_MAX_AUTH_MESSAGE_BYTES = 4096;
const DEFAULT_UNAUTHENTICATED_TIMEOUT_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONNECTION_MS = 60 * 60 * 1000;

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
    tokenRegistry = null,
    tokenRegistryConsume = true,
    expectedSessionId,
    expectedHpc,
    origin,
    tokenTtlMs = TOKEN_TTL_MS,
  } = options;

  if (typeof relayToken !== 'string' || relayToken.length < 8) {
    return null;
  }

  if (tokenResolver) {
    return tokenResolver(relayToken);
  }

  if (tokenRegistry) {
    const expected = {
      scope: TOKEN_SCOPES.RELAY,
      sessionId: expectedSessionId,
      hpc: expectedHpc,
      origin,
    };
    const record = tokenRegistryConsume ?
      tokenRegistry.consumeToken(relayToken, expected) :
      tokenRegistry.validateToken(relayToken, expected);
    const hpc = normalizeAlias(record.hpc || record.metadata?.hpc || record.metadata?.alias);
    if (!hpc) {
      return null;
    }
    return {
      sessionId: record.sessionId,
      userId: record.metadata?.userId,
      hpc,
      expiresAt: record.expiresAt,
      tokenFingerprint: record.fingerprint,
      metadata: record.metadata || {},
    };
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
    auditLogger = createAuditLogger({logger}),
    connectTcp = defaultConnectTcp,
    tokenOptions = {},
    maxAuthMessageBytes = DEFAULT_MAX_AUTH_MESSAGE_BYTES,
    unauthenticatedTimeoutMs = DEFAULT_UNAUTHENTICATED_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    maxConnectionMs = DEFAULT_MAX_CONNECTION_MS,
    maxConnectionsPerSession = 1,
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
  const activeConnections = new Map();

  function incrementActive(session) {
    if (!session?.sessionId || !session?.hpc) {
      return null;
    }
    const key = `${session.sessionId}:${session.hpc}`;
    const count = activeConnections.get(key) || 0;
    if (count >= maxConnectionsPerSession) {
      throw new Error('relay connection limit exceeded');
    }
    activeConnections.set(key, count + 1);
    return key;
  }

  function decrementActive(key) {
    if (!key) {
      return;
    }
    const count = activeConnections.get(key) || 0;
    if (count <= 1) {
      activeConnections.delete(key);
    } else {
      activeConnections.set(key, count - 1);
    }
  }

  wss.on('connection', (ws, req) => {
    let authed = false;
    let tcp = null;
    let session = null;
    let target = null;
    let activeKey = null;
    let closed = false;
    let idleTimer = null;
    let maxConnectionTimer = null;
    const remoteAddress = req.socket.remoteAddress;

    const unauthenticatedTimer = setTimeout(() => {
      auditLogger.event('relay.auth_timeout', {remoteAddress});
      safeClose(ws, 1008, 'auth_timeout');
    }, unauthenticatedTimeoutMs);

    function clearTimers() {
      clearTimeout(unauthenticatedTimer);
      clearTimeout(idleTimer);
      clearTimeout(maxConnectionTimer);
    }

    function resetIdleTimer() {
      if (!authed || idleTimeoutMs <= 0) {
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        auditLogger.event('relay.idle_timeout', {
          sessionId: session?.sessionId,
          hpc: session?.hpc,
          tokenFingerprint: session?.tokenFingerprint,
        });
        safeClose(ws, 1000, 'idle_timeout');
      }, idleTimeoutMs);
    }

    function startMaxConnectionTimer() {
      if (maxConnectionMs <= 0) {
        return;
      }
      maxConnectionTimer = setTimeout(() => {
        auditLogger.event('relay.max_lifetime_exceeded', {
          sessionId: session?.sessionId,
          hpc: session?.hpc,
          tokenFingerprint: session?.tokenFingerprint,
        });
        safeClose(ws, 1000, 'max_lifetime_exceeded');
      }, maxConnectionMs);
    }

    auditLogger.event('relay.connection_open', {remoteAddress});

    ws.on('message', async (message, isBinary) => {
      try {
        if (!authed) {
          if (isBinary) {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'auth_required',
            });
            safeClose(ws, 1008, 'auth_required');
            return;
          }

          if (Buffer.byteLength(message) > maxAuthMessageBytes) {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'auth_message_too_large',
            });
            safeClose(ws, 1009, 'auth_message_too_large');
            return;
          }

          let auth;
          try {
            auth = JSON.parse(message.toString('utf8'));
          } catch (_e) {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'bad_auth_json',
            });
            safeClose(ws, 1008, 'bad_auth_json');
            return;
          }

          if (!auth || auth.type !== 'auth') {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'bad_auth_type',
            });
            safeClose(ws, 1008, 'bad_auth_type');
            return;
          }

          if ('host' in auth || 'port' in auth || 'target' in auth) {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'client_target_not_allowed',
            });
            safeClose(ws, 1008, 'client_target_not_allowed');
            return;
          }

          try {
            session = await resolveRelayToken(auth.relayToken, {
              ...tokenOptions,
              origin: tokenOptions.origin,
            });
          } catch (error) {
            const errorCode = error instanceof TokenRegistryError ?
              error.code :
              'invalid_or_expired_token';
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode,
              token: auth.relayToken,
            });
            safeClose(ws, 1008, errorCode);
            return;
          }
          if (!session || session.expiresAt < Date.now()) {
            auditLogger.event('relay.auth_rejected', {
              remoteAddress,
              errorCode: 'invalid_or_expired_token',
              token: auth.relayToken,
            });
            safeClose(ws, 1008, 'invalid_or_expired_token');
            return;
          }

          target = targetForSession(session, allowedHosts);
          if (!target) {
            auditLogger.event('relay.auth_rejected', {
              sessionId: session.sessionId,
              hpc: session.hpc,
              tokenFingerprint: session.tokenFingerprint,
              errorCode: 'target_not_allowed',
            });
            safeClose(ws, 1008, 'target_not_allowed');
            return;
          }

          try {
            activeKey = incrementActive(session);
          } catch (_error) {
            auditLogger.event('relay.auth_rejected', {
              sessionId: session.sessionId,
              hpc: session.hpc,
              tokenFingerprint: session.tokenFingerprint,
              errorCode: 'connection_limit_exceeded',
            });
            safeClose(ws, 1008, 'connection_limit_exceeded');
            return;
          }

          try {
            tcp = await connectTcp(target);
          } catch (error) {
            decrementActive(activeKey);
            activeKey = null;
            auditLogger.event('relay.tcp_connect_failed', {
              sessionId: session.sessionId,
              hpc: target.alias,
              tokenFingerprint: session.tokenFingerprint,
              errorCode: error.code || 'tcp_connect_failed',
            });
            safeClose(ws, 1011, 'tcp_connect_failed');
            return;
          }

          tcp.on('data', (chunk) => {
            resetIdleTimer();
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
          clearTimeout(unauthenticatedTimer);
          startMaxConnectionTimer();
          resetIdleTimer();
          ws.send(JSON.stringify({type: 'ok'}));

          auditLogger.event('relay.connected', {
            sessionId: session.sessionId,
            hpc: target.alias,
            tokenFingerprint: session.tokenFingerprint,
            origin: req.headers.origin || undefined,
            remoteAddress,
          });
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
        resetIdleTimer();
        tcp.write(Buffer.from(message));
      } catch (error) {
        auditLogger.event('relay.error', {
          sessionId: session?.sessionId,
          hpc: session?.hpc,
          tokenFingerprint: session?.tokenFingerprint,
          errorCode: error.code || 'relay_error',
        });
        safeClose(ws, 1011, 'relay_error');
      }
    });

    ws.on('close', () => {
      if (closed) {
        return;
      }
      closed = true;
      clearTimers();
      decrementActive(activeKey);
      if (tcp && !tcp.destroyed) {
        tcp.destroy();
      }
      auditLogger.event('relay.connection_close', {
        sessionId: session?.sessionId,
        hpc: session?.hpc,
        tokenFingerprint: session?.tokenFingerprint,
      });
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
