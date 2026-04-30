#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRelayServer} from '../server/relay/relay.js';
import {
  policyAllowsApiBaseUrl,
  policyAllowsRelayUrl,
  requireKnownHpcAlias,
  validatePolicy,
  validateSessionId,
} from '../extension/js/slaif_policy.js';
import {
  policyFingerprint,
  verifySignedPolicyEnvelope,
} from '../extension/js/slaif_policy_signature.js';
import {
  parseCliArgs,
  readJson,
  writeJson,
} from '../scripts/pilot/pilot_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function defaultLogger(quiet) {
  if (quiet) {
    return {log() {}, info() {}, warn() {}, error() {}};
  }
  return console;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function listen(server, {host, port}) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function loadSignedPolicy({signedPolicy, trustRoots, allowLocalDev = true}) {
  const envelope = readJson(signedPolicy);
  const roots = readJson(trustRoots);
  const policy = await verifySignedPolicyEnvelope(envelope, roots);
  validatePolicy(policy, {allowLocalDev});
  return {
    envelope,
    trustRoots: roots,
    policy,
    fingerprint: await policyFingerprint(envelope),
  };
}

async function startMockPilotWebApiServer({
  host,
  port,
  hpc,
  sessionId,
  launchToken,
  relayToken,
  relayUrl,
  usernameHint,
  relayTokenExpiresAt,
}) {
  const server = http.createServer((req, res) => {
    const origin = `http://${host}:${server.address().port}`;
    const url = new URL(req.url, origin);

    if (url.pathname === '/launcher.html') {
      const extensionId = url.searchParams.get('extensionId') || '';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>SLAIF real-HPC pilot launcher</title></head>
<body>
  <button id="launch">Launch SLAIF Connect pilot</button>
  <pre id="result" data-launch-result="idle"></pre>
  <script>
    const extensionId = ${JSON.stringify(extensionId)};
    const message = {
      type: 'slaif.startSession',
      version: 1,
      hpc: ${JSON.stringify(hpc)},
      sessionId: ${JSON.stringify(sessionId)},
      launchToken: ${JSON.stringify(launchToken)}
    };
    document.getElementById('launch').addEventListener('click', () => {
      const result = document.getElementById('result');
      if (!extensionId) {
        result.dataset.launchResult = 'failed';
        result.textContent = 'extensionId query parameter missing';
        return;
      }
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        if (chrome.runtime.lastError) {
          result.dataset.launchResult = 'failed';
          result.textContent = chrome.runtime.lastError.message;
          return;
        }
        result.dataset.launchResult = response && response.ok ? 'accepted' : 'rejected';
        result.textContent = JSON.stringify(response);
      });
    });
  </script>
</body>
</html>`);
      return;
    }

    if (url.pathname === `/api/connect/session/${encodeURIComponent(sessionId)}`) {
      if (req.headers.authorization !== `Bearer ${launchToken}`) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({
        type: 'slaif.sessionDescriptor',
        version: 1,
        sessionId,
        hpc,
        relayUrl,
        relayToken,
        relayTokenExpiresAt,
        usernameHint,
        mode: 'launch',
      }));
      return;
    }

    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('not found\n');
  });

  await listen(server, {host, port});
  const webOrigin = `http://${host}:${server.address().port}`;
  return {
    server,
    webOrigin,
    apiBaseUrl: webOrigin,
    launcherUrl: `${webOrigin}/launcher.html`,
    close: () => closeServer(server),
  };
}

export async function startRealHpcPilotStack(options = {}) {
  if (!options.allowRealHpc) {
    throw new Error('refusing to start real-HPC pilot stack without --allow-real-hpc');
  }
  const root = options.root || repoRoot;
  const buildDir = options.buildDir || path.join(root, 'build/extension');
  const host = options.host || '127.0.0.1';
  const relayPort = Number(options.relayPort || 18181);
  const webPort = Number(options.webPort || 18180);
  const hpc = options.alias;
  const sessionId = options.sessionId || `sess_real_hpc_${crypto.randomBytes(8).toString('hex')}`;
  const launchToken = options.launchToken || `pilot-launch-${crypto.randomBytes(16).toString('hex')}`;
  const relayToken = options.relayToken || `pilot-relay-${crypto.randomBytes(16).toString('hex')}`;
  const usernameHint = options.usernameHint;
  const expectedOutput = options.expectedOutput || 'slaif-pilot-ok';
  const logger = options.logger || defaultLogger(options.quiet);

  if (!hpc) {
    throw new Error('--alias is required');
  }
  validateSessionId(sessionId);
  if (!fs.existsSync(path.join(buildDir, 'manifest.json'))) {
    throw new Error('build/extension is missing. Run npm run build:extension first.');
  }

  const verified = await loadSignedPolicy({
    signedPolicy: options.signedPolicy,
    trustRoots: options.trustRoots,
    allowLocalDev: true,
  });
  const policyHost = requireKnownHpcAlias(verified.policy, hpc);

  const relayUrl = `ws://${host}:${relayPort}/ssh-relay`;
  const webOrigin = `http://${host}:${webPort}`;
  policyAllowsRelayUrl(verified.policy, relayUrl, {allowLocalDev: true});
  policyAllowsApiBaseUrl(verified.policy, webOrigin, {allowLocalDev: true});

  let relay = null;
  let webApi = null;
  let stopped = false;
  const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
  const signedPolicyPath = path.join(buildDir, 'config/hpc_policy.local.json');
  const trustRootsPath = path.join(buildDir, 'config/policy_trust_roots.local.json');

  async function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    if (relay) {
      await relay.close().catch(() => {});
      relay = null;
    }
    if (webApi) {
      await webApi.close().catch(() => {});
      webApi = null;
    }
    fs.rmSync(configPath, {force: true});
    fs.rmSync(signedPolicyPath, {force: true});
    fs.rmSync(trustRootsPath, {force: true});
  }

  try {
    relay = createRelayServer({
      allowedHosts: {
        [hpc]: {
          host: policyHost.sshHost,
          port: policyHost.sshPort,
        },
      },
      tokenOptions: {
        devMode: true,
        devTokenMap: {
          [relayToken]: {
            hpc,
            sessionId,
            userId: 'real-hpc-pilot-user',
          },
        },
      },
      logger,
    });
    await relay.listen({host, port: relayPort});
    const relayTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    webApi = await startMockPilotWebApiServer({
      host,
      port: webPort,
      hpc,
      sessionId,
      launchToken,
      relayToken,
      relayUrl,
      usernameHint,
      relayTokenExpiresAt,
    });

    const runtimeConfig = {
      mode: 'local-dev',
      hpc,
      apiBaseUrl: webApi.apiBaseUrl,
      launcherUrl: webApi.launcherUrl,
      webOrigin: webApi.webOrigin,
      username: usernameHint,
      sessionId,
      expectedOutput,
      pilot: true,
    };

    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    writeJson(configPath, runtimeConfig);
    fs.copyFileSync(options.signedPolicy, signedPolicyPath);
    fs.copyFileSync(options.trustRoots, trustRootsPath);

    return {
      root,
      buildDir,
      policy: verified.policy,
      policyFingerprint: verified.fingerprint,
      policyHost,
      hpc,
      sessionId,
      launchToken,
      relayToken,
      relay,
      relayUrl,
      relayPort,
      webApi,
      webOrigin: webApi.webOrigin,
      apiBaseUrl: webApi.apiBaseUrl,
      launcherUrl: webApi.launcherUrl,
      configPath,
      signedPolicyPath,
      trustRootsPath,
      runtimeConfig,
      expectedOutput,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function stopRealHpcPilotStack(stack) {
  if (stack?.stop) {
    await stack.stop();
  }
}

function usage() {
  return `Usage:
  npm run pilot:stack -- --allow-real-hpc --signed-policy <file> --trust-roots <file> --alias <alias> [--username-hint <name>]

Options:
  --relay-port <port>  Local relay port. Default: 18181
  --web-port <port>    Local mock SLAIF web/API port. Default: 18180
  --expected-output <text>  Expected fixed pilot output. Default: slaif-pilot-ok`;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2), {boolean: ['allowRealHpc', 'quiet']});
  for (const required of ['signedPolicy', 'trustRoots', 'alias']) {
    if (!args[required]) {
      throw new Error(`${usage()}\n\nmissing --${required.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
    }
  }
  const stack = await startRealHpcPilotStack(args);
  const cleanupAndExit = async (code = 0) => {
    await stopRealHpcPilotStack(stack);
    process.exit(code);
  };
  process.once('SIGINT', () => cleanupAndExit(0));
  process.once('SIGTERM', () => cleanupAndExit(0));

  console.log('SLAIF real-HPC pilot stack is running.');
  console.log(`Policy: ${stack.policy.policyId} sequence ${stack.policy.sequence}`);
  console.log(`Policy fingerprint: ${stack.policyFingerprint}`);
  console.log(`Pilot alias: ${stack.hpc}`);
  console.log(`Signed-policy target: ${stack.policyHost.sshHost}:${stack.policyHost.sshPort}`);
  console.log(`Relay URL: ${stack.relayUrl}`);
  console.log(`Mock SLAIF launcher: ${stack.launcherUrl}?extensionId=<extension-id>`);
  console.log(`Mock SLAIF API base: ${stack.apiBaseUrl}`);
  console.log(`Generated extension runtime config: ${stack.configPath}`);
  console.log('');
  console.log('Manual browser steps:');
  console.log('1. Load build/extension as an unpacked Chrome extension.');
  console.log('2. Open the mock launcher URL with ?extensionId=<extension-id>.');
  console.log('3. Click "Launch SLAIF Connect pilot".');
  console.log('4. Authenticate inside the extension SSH session using the real HPC mechanism.');
  console.log(`5. Expected fixed command output: ${stack.expectedOutput}`);
  console.log('');
  console.log('The relay target came from the verified signed policy, not CLI host/port arguments.');
  console.log('Press Ctrl-C to stop the mock API/relay and remove local generated extension config.');

  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
