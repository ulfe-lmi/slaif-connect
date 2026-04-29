import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {WebSocketServer} from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOSTS_FILE = process.env.SLAIF_RELAY_HOSTS_FILE || join(__dirname, 'allowed_hpc_hosts.json');
const TOKEN_TTL_MS = Number(process.env.SLAIF_RELAY_TOKEN_TTL_MS || 5 * 60 * 1000);
const DEMO = process.env.SLAIF_RELAY_DEMO === '1';

function loadAllowedHosts() {
  const text = fs.readFileSync(HOSTS_FILE, 'utf8');
  const parsed = JSON.parse(text);
  if (!parsed.hosts || typeof parsed.hosts !== 'object') {
    throw new Error('allowed_hpc_hosts.json must contain {"hosts": {...}}');
  }
  return parsed.hosts;
}

const allowedHosts = loadAllowedHosts();

function validateAlias(alias) {
  return typeof alias === 'string' && /^[a-z0-9_-]{1,64}$/i.test(alias);
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch (_e) {
    // Ignore close races.
  }
}

async function verifyRelayToken(relayToken) {
  // Production implementation should call or share state with the SLAIF session
  // API. The token must map to a server-side approved session and HPC alias.
  //
  // Required returned shape:
  //   {sessionId, userId, hpc, expiresAt}
  //
  // The token must not contain a raw host or port supplied by the client.

  if (typeof relayToken !== 'string' || relayToken.length < 16) {
    return null;
  }

  if (DEMO) {
    // Local-only demo format:
    //   demo:<hpc-alias>:<session-id>
    const parts = relayToken.split(':');
    if (parts.length === 3 && parts[0] === 'demo' && validateAlias(parts[1])) {
      return {
        userId: 'demo-user',
        hpc: parts[1].toLowerCase(),
        sessionId: parts[2],
        expiresAt: Date.now() + TOKEN_TTL_MS,
      };
    }
  }

  // TODO production:
  // return await lookupTokenInSlaifSessionStore(relayToken)
  return null;
}

function targetForSession(session) {
  if (!session || !validateAlias(session.hpc)) {
    return null;
  }

  const target = allowedHosts[session.hpc.toLowerCase()];
  if (!target) {
    return null;
  }

  if (typeof target.host !== 'string' || !Number.isInteger(target.port)) {
    throw new Error(`invalid configured target for ${session.hpc}`);
  }

  return target;
}

function connectTcp(target) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host: target.host, port: target.port});
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('tcp connect timeout'));
    }, 15000);

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

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('ok\n');
    return;
  }
  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end('not found\n');
});

const wss = new WebSocketServer({
  server,
  path: '/ssh-relay',
  // The extension sends this subprotocol. Rejecting non-matching protocols can
  // be added here once extension id/origin policy is finalized.
});

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

        if (auth.type !== 'auth') {
          safeClose(ws, 1008, 'bad_auth_type');
          return;
        }

        session = await verifyRelayToken(auth.relayToken);
        if (!session || session.expiresAt < Date.now()) {
          safeClose(ws, 1008, 'invalid_or_expired_token');
          return;
        }

        target = targetForSession(session);
        if (!target) {
          safeClose(ws, 1008, 'target_not_allowed');
          return;
        }

        tcp = await connectTcp(target);

        tcp.on('data', (chunk) => {
          if (ws.readyState === ws.OPEN) {
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

        console.log(`relay connected session=${session.sessionId} hpc=${session.hpc} target=${target.host}:${target.port} origin=${req.headers.origin || '-'}`);
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

      // Do not log SSH payloads.
      tcp.write(Buffer.from(message));
    } catch (error) {
      console.error('relay error:', error.message);
      safeClose(ws, 1011, 'relay_error');
    }
  });

  ws.on('close', () => {
    if (tcp && !tcp.destroyed) {
      tcp.destroy();
    }
  });
});

server.listen(PORT, () => {
  console.log(`SLAIF relay listening on http://127.0.0.1:${PORT}/ssh-relay`);
  if (DEMO) {
    console.log('DEMO mode enabled. Example relay token: demo:vegahpc:sess_abcdefgh');
  }
});
