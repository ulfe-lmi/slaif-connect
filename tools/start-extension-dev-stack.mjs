import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRelayServer} from '../server/relay/relay.js';
import {
  base64urlEncode,
  canonicalPolicySigningInput,
} from '../extension/js/slaif_policy_signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, '..');

export const DEFAULT_DEV_TOKEN = 'dev-token-test-sshd';
export const DEFAULT_DEV_HPC = 'test-sshd';
export const DEFAULT_HOST_KEY_ALIAS = 'test-sshd';
export const DEFAULT_EXPECTED_JOB_ID = '424242';
export const DEFAULT_EXPECTED_OUTPUT = `Submitted batch job ${DEFAULT_EXPECTED_JOB_ID}`;
export const DEFAULT_LAUNCH_TOKEN = 'dev-launch-token-test-sshd';
export const DEFAULT_JOB_REPORT_TOKEN = 'dev-job-report-token-test-sshd';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || defaultRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runQuiet(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || defaultRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    ...options,
  });
}

function requireCommand(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error(`missing prerequisite: ${command}`);
  }
}

function dockerPort(containerId, root) {
  const result = run('docker', ['port', containerId, '22/tcp'], {cwd: root});
  const line = result.stdout.trim().split('\n')[0];
  const match = line.match(/:(\d+)$/);
  if (!match) {
    throw new Error(`could not parse docker port output: ${result.stdout}`);
  }
  return Number(match[1]);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function waitForPort(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for sshd on localhost:${port}`);
}

function publicKeyLine(filePath, alias) {
  const parts = fs.readFileSync(filePath, 'utf8').trim().split(/\s+/);
  return `${alias} ${parts[0]} ${parts[1]}`;
}

async function createPolicyKeyMaterial(keyId) {
  const keyPair = await crypto.webcrypto.subtle.generateKey(
      {name: 'ECDSA', namedCurve: 'P-256'},
      true,
      ['sign', 'verify'],
  );
  const publicSpki = await crypto.webcrypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    keyId,
    privateKey: keyPair.privateKey,
    trustRoots: {
      type: 'slaif.policyTrustRoots',
      version: 1,
      keys: [
        {
          keyId,
          algorithm: 'ECDSA-P256-SHA256',
          publicKeySpkiBase64: Buffer.from(publicSpki).toString('base64'),
        },
      ],
    },
  };
}

async function signPolicyPayload(payload, {keyId, privateKey, signedAt = new Date().toISOString()}) {
  const envelope = {
    type: 'slaif.signedHpcPolicy',
    version: 1,
    algorithm: 'ECDSA-P256-SHA256',
    keyId,
    signedAt,
    payload,
  };
  const signature = await crypto.webcrypto.subtle.sign(
      {name: 'ECDSA', hash: 'SHA-256'},
      privateKey,
      new TextEncoder().encode(canonicalPolicySigningInput(envelope)),
  );
  envelope.signature = base64urlEncode(signature);
  return envelope;
}

function defaultLogger(quiet) {
  if (!quiet) {
    return console;
  }
  return {
    log() {},
    info() {},
    warn() {},
    error() {},
  };
}

function closeHttpServer(server) {
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

async function startMockSlaifWebApiServer({
  host = '127.0.0.1',
  hpc,
  sessionId,
  launchToken,
  relayToken,
  jobReportToken,
  relayUrl,
  username,
  relayTokenExpiresAt,
  jobReportTokenExpiresAt,
}) {
  const jobReports = [];
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
<head><meta charset="utf-8"><title>SLAIF Connect local launcher</title></head>
<body>
  <button id="launch">Launch SLAIF Connect</button>
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
    async function sendLaunch() {
      const result = document.getElementById('result');
      try {
        if (!extensionId) {
          throw new Error('extensionId query parameter missing');
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
      } catch (error) {
        result.dataset.launchResult = 'failed';
        result.textContent = error.message || String(error);
      }
    }
    document.getElementById('launch').addEventListener('click', sendLaunch);
  </script>
</body>
</html>`);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization,content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '60',
      });
      res.end();
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
        jobReportToken,
        jobReportTokenExpiresAt,
        usernameHint: username,
        mode: 'launch',
      }));
      return;
    }

    if (url.pathname === `/api/connect/session/${encodeURIComponent(sessionId)}/job-report`) {
      if (req.method !== 'POST') {
        res.writeHead(405, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'method_not_allowed'}));
        return;
      }
      if (req.headers.authorization !== `Bearer ${jobReportToken}`) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16384) {
          req.destroy();
        }
      });
      req.on('end', () => {
        let report;
        try {
          report = JSON.parse(body);
          if (report.type !== 'slaif.jobReport' ||
              report.version !== 1 ||
              report.sessionId !== sessionId ||
              report.hpc !== hpc ||
              !['submitted', 'job_id_not_found', 'ssh_failed'].includes(report.status)) {
            throw new Error('invalid report');
          }
          if (report.status === 'submitted' &&
              (report.scheduler !== 'slurm' || !/^[0-9]+$/.test(report.jobId))) {
            throw new Error('invalid submitted report');
          }
          for (const forbidden of [
            'stdout',
            'stderr',
            'transcript',
            'password',
            'otp',
            'privateKey',
            'relayToken',
            'launchToken',
            'jobReportToken',
          ]) {
            if (Object.hasOwn(report, forbidden)) {
              throw new Error(`forbidden report field ${forbidden}`);
            }
          }
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: error.message || 'invalid_report'}));
          return;
        }
        jobReports.push(report);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ok: true}));
      });
      return;
    }

    if (url.pathname === '/api/test/job-reports') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({jobReports}));
      return;
    }

    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('not found\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const webOrigin = `http://${host}:${server.address().port}`;
  return {
    server,
    webOrigin,
    apiBaseUrl: webOrigin,
    launcherUrl: `${webOrigin}/launcher.html`,
    jobReports,
    close: () => closeHttpServer(server),
  };
}

export async function startExtensionDevStack(options = {}) {
  const root = options.root || defaultRoot;
  const buildDir = options.buildDir || path.join(root, 'build/extension');
  const token = options.relayToken || DEFAULT_DEV_TOKEN;
  const hpc = options.hpc || DEFAULT_DEV_HPC;
  const hostKeyAlias = options.hostKeyAlias || DEFAULT_HOST_KEY_ALIAS;
  const expectedOutput = options.expectedOutput || DEFAULT_EXPECTED_OUTPUT;
  const expectedJobId = options.expectedJobId || DEFAULT_EXPECTED_JOB_ID;
  const sessionId = options.sessionId || `sess_local_dev_${crypto.randomBytes(8).toString('hex')}`;
  const password = options.password || `slaif-${crypto.randomBytes(6).toString('base64url')}`;
  const launchToken = options.launchToken || `${DEFAULT_LAUNCH_TOKEN}-${crypto.randomBytes(8).toString('hex')}`;
  const jobReportToken = options.jobReportToken || `${DEFAULT_JOB_REPORT_TOKEN}-${crypto.randomBytes(8).toString('hex')}`;
  const imageTag = options.imageTag || `slaif-extension-dev-sshd-${process.pid}-${Date.now()}`;
  const policyKeyId = options.policyKeyId || 'slaif-policy-local-dev';
  const logger = options.logger || defaultLogger(options.quiet);

  for (const command of ['docker', 'ssh-keygen']) {
    requireCommand(command);
  }

  if (!fs.existsSync(path.join(buildDir, 'manifest.json'))) {
    throw new Error('build/extension is missing. Run npm run build:extension first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-extension-dev-'));
  let containerId = null;
  let relay = null;
  let webApi = null;
  let stopped = false;

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
    if (containerId) {
      runQuiet('docker', ['rm', '-f', containerId], {cwd: root});
      containerId = null;
    }
    runQuiet('docker', ['rmi', '-f', imageTag], {cwd: root});
    const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
    fs.rmSync(configPath, {force: true});
    fs.rmSync(path.join(buildDir, 'config/hpc_policy.local.json'), {force: true});
    fs.rmSync(path.join(buildDir, 'config/policy_trust_roots.local.json'), {force: true});
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  try {
    const hostKey = path.join(tempDir, 'ssh_host_ed25519_key');
    const wrongHostKey = path.join(tempDir, 'wrong_ssh_host_ed25519_key');
    const clientKey = path.join(tempDir, 'unused_client_ed25519');
    const launcherSource = path.join(root, 'remote/launcher/slaif-launch');
    const launcherTarget = path.join(tempDir, 'slaif-launch');
    fs.copyFileSync(launcherSource, launcherTarget);
    fs.chmodSync(launcherTarget, 0o555);
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey], {cwd: root});
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', wrongHostKey], {cwd: root});
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', clientKey], {cwd: root});
    fs.writeFileSync(path.join(tempDir, 'authorized_keys'),
        fs.readFileSync(`${clientKey}.pub`, 'utf8'));

    run('docker', ['build', '-t', imageTag, path.join(root, 'tests/relay/sshd')], {cwd: root});
    containerId = run('docker', [
      'run',
      '-d',
      '-p', '127.0.0.1::22',
      '-v', `${tempDir}:/keys:ro`,
      '-e', `SLAIF_TEST_PASSWORD=${password}`,
      imageTag,
    ], {cwd: root}).stdout.trim();

    const sshdPort = dockerPort(containerId, root);
    await waitForPort(ssdPortOrThrow(sshdPort));

    relay = createRelayServer({
      allowedHosts: {
        [hpc]: {
          host: '127.0.0.1',
          port: sshdPort,
        },
      },
      tokenOptions: {
        devMode: true,
        devTokenMap: {
          [token]: {
            hpc,
            sessionId,
            userId: 'local-dev-user',
          },
        },
      },
      logger,
    });
    await relay.listen({host: '127.0.0.1', port: 0});
    const relayPort = relay.address().port;
    const relayUrl = `ws://127.0.0.1:${relayPort}/ssh-relay`;
    const relayTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const jobReportTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    webApi = await startMockSlaifWebApiServer({
      hpc,
      sessionId,
      launchToken,
      relayToken: token,
      jobReportToken,
      relayUrl,
      username: 'testuser',
      relayTokenExpiresAt,
      jobReportTokenExpiresAt,
    });

    const runtimeConfig = {
      mode: 'local-dev',
      hpc,
      apiBaseUrl: webApi.apiBaseUrl,
      launcherUrl: webApi.launcherUrl,
      webOrigin: webApi.webOrigin,
      launchToken,
      relayUrl,
      relayToken: token,
      username: 'testuser',
      password,
      sessionId,
      hostKeyAlias,
      expectedOutput,
      expectedJobId,
      expectedScheduler: 'slurm',
    };

    const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
    const signedPolicyPath = path.join(buildDir, 'config/hpc_policy.local.json');
    const trustRootsPath = path.join(buildDir, 'config/policy_trust_roots.local.json');
    const knownHostsLine = publicKeyLine(
        options.wrongKnownHost ? `${wrongHostKey}.pub` : `${hostKey}.pub`,
        hostKeyAlias,
    );
    const policyKeyMaterial = await createPolicyKeyMaterial(policyKeyId);
    const trustRoots = options.wrongPolicySigner ?
      (await createPolicyKeyMaterial(`${policyKeyId}-untrusted`)).trustRoots :
      policyKeyMaterial.trustRoots;
    const policyPayload = {
      type: 'slaif.hpcPolicy',
      version: 1,
      policyId: 'slaif-hpc-policy-local-dev',
      sequence: 1,
      validFrom: new Date(Date.now() - 60000).toISOString(),
      validUntil: new Date(Date.now() + 10 * 60000).toISOString(),
      allowedApiOrigins: [webApi.webOrigin],
      allowedRelayOrigins: [
        options.relayOriginMismatch ? 'ws://127.0.0.1:1' : new URL(relayUrl).origin,
      ],
      hosts: {
        [hpc]: {
          displayName: 'Local development test sshd',
          sshHost: '127.0.0.1',
          sshPort: 22,
          hostKeyAlias,
          knownHosts: [knownHostsLine],
          remoteCommandTemplate: options.noSlurmJobOutput ?
            '/bin/sh -lc "printf \'SLAIF session ${SESSION_ID}\\n\'"' :
            `SLAIF_LAUNCHER_TEST_JOB_ID=${expectedJobId} /keys/slaif-launch --session ${'${SESSION_ID}'}`,
          allowInteractiveTerminal: false,
          developmentOnly: true,
        },
      },
    };
    if (options.expiredPolicy) {
      policyPayload.validFrom = new Date(Date.now() - 10 * 60000).toISOString();
      policyPayload.validUntil = new Date(Date.now() - 60000).toISOString();
    }
    const signedPolicy = await signPolicyPayload(policyPayload, policyKeyMaterial);
    if (options.tamperSignedPolicy) {
      signedPolicy.payload.hosts[hpc].remoteCommandTemplate = 'printf tampered-policy';
    }

    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`);
    fs.writeFileSync(signedPolicyPath, `${JSON.stringify(signedPolicy, null, 2)}\n`);
    fs.writeFileSync(trustRootsPath, `${JSON.stringify(trustRoots, null, 2)}\n`);

    return {
      root,
      buildDir,
      tempDir,
      imageTag,
      containerId,
      sshdPort,
      relay,
      relayPort,
      webApi,
      webOrigin: webApi.webOrigin,
      apiBaseUrl: webApi.apiBaseUrl,
      launcherUrl: webApi.launcherUrl,
      configPath,
      signedPolicyPath,
      trustRootsPath,
      runtimeConfig,
      launchToken,
      password,
      expectedOutput,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

function ssdPortOrThrow(port) {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid sshd port: ${port}`);
  }
  return port;
}

export async function stopExtensionDevStack(stack) {
  if (stack?.stop) {
    await stack.stop();
  }
}

async function main() {
  const stack = await startExtensionDevStack();

  const cleanupAndExit = async (code = 0) => {
    await stopExtensionDevStack(stack);
    process.exit(code);
  };
  process.once('SIGINT', () => cleanupAndExit(0));
  process.once('SIGTERM', () => cleanupAndExit(0));

  console.log('SLAIF extension development stack is running.');
  console.log(`Relay URL: ${stack.runtimeConfig.relayUrl}`);
  console.log(`Mock SLAIF launcher: ${stack.launcherUrl}?extensionId=<extension-id>`);
  console.log(`Mock SLAIF API base: ${stack.apiBaseUrl}`);
  console.log(`Test sshd container: ${stack.containerId}`);
  console.log(`Generated extension config: ${stack.configPath}`);
  console.log(`Development password for testuser: ${stack.password}`);
  console.log('');
  console.log('Manual browser steps:');
  console.log('1. Load build/extension as an unpacked Chrome extension.');
  console.log('2. Open the mock launcher URL with ?extensionId=<extension-id>.');
  console.log('3. Click "Launch SLAIF Connect".');
  console.log(`4. When OpenSSH asks for testuser password, enter: ${stack.password}`);
  console.log(`5. Expected command output: ${stack.expectedOutput}`);
  console.log('');
  console.log('Press Ctrl-C to stop the relay and remove the container.');

  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
