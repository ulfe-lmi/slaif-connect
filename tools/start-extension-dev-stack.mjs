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
import {createAuditLogger} from '../server/logging/audit_log.js';
import {createMemoryAuditSink} from '../server/logging/audit_sink.js';
import {createMetricsRegistry} from '../server/metrics/metrics_registry.js';
import {createObservabilityHttpHandler} from '../server/observability/observability_http.js';
import {createRateLimiter} from '../server/rate_limit/rate_limiter.js';
import {createTokenRegistry, TOKEN_SCOPES} from '../server/tokens/token_registry.js';
import {buildDefaultPayloadCatalog} from '../server/workloads/payload_catalog.js';
import {validatePayloadResult} from '../server/workloads/diagnostic_result.js';
import {
  base64urlEncode,
  canonicalPolicySigningInput,
} from '../extension/js/slaif_policy_signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, '..');

export const DEFAULT_DEV_HPC = 'test-sshd';
export const DEFAULT_HOST_KEY_ALIAS = 'test-sshd';
export const DEFAULT_PAYLOAD_ID = 'gpu_diagnostics_v1';
export const DEFAULT_EXPECTED_JOB_ID = '424242';
export const DEFAULT_EXPECTED_OUTPUT = `Submitted batch job ${DEFAULT_EXPECTED_JOB_ID}`;

function localIntentForPayload({sessionId, hpc, payloadId}) {
  const createdAt = new Date(Date.now() - 60 * 1000);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  return {
    type: 'slaif.sessionIntent',
    version: 1,
    sessionId,
    hpc,
    payloadId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    launcher: {
      mode: 'normal',
    },
  };
}

function localProfileForPayload(payloadId) {
  const gpuPayload = payloadId === 'gpu_diagnostics_v1' || payloadId === 'gams_chat_v1';
  return {
    profileId: payloadId === 'gams_chat_v1' ? 'gams_chat_v1_scaffold' : `${payloadId}_local_dev`,
    payloadId,
    scheduler: 'slurm',
    jobName: payloadId === 'gams_chat_v1' ? 'slaif-gams-chat' :
      (gpuPayload ? 'slaif-gpu-diag' : 'slaif-cpu-diag'),
    timeLimit: payloadId === 'gams_chat_v1' ? '00:10:00' : '00:05:00',
    cpusPerTask: 1,
    memory: payloadId === 'gams_chat_v1' ? '2G' : '1G',
    partition: '',
    account: '',
    qos: '',
    ...(gpuPayload ? {gres: 'gpu:1', gpus: 1} : {}),
    maxOutputBytes: 65536,
    template: payloadId === 'gams_chat_v1' ? 'gams_chat_v1_scaffold' : payloadId,
  };
}

function localProfileCatalog(payloadId) {
  return {
    type: 'slaif.slurmProfileCatalog',
    version: 1,
    profiles: {
      [payloadId]: localProfileForPayload(payloadId),
    },
  };
}

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

export function prepareLauncherKeysDirectory({root = defaultRoot, tempDir}) {
  if (!tempDir) {
    throw new Error('missing tempDir for launcher keys directory');
  }

  fs.mkdirSync(tempDir, {recursive: true});
  fs.chmodSync(tempDir, 0o755);

  const launcherSource = path.join(root, 'remote/launcher/slaif-launch');
  if (!fs.existsSync(launcherSource)) {
    throw new Error(`missing launcher source: ${launcherSource}`);
  }
  if ((fs.statSync(launcherSource).mode & 0o111) === 0) {
    throw new Error(`launcher source is not executable: ${launcherSource}`);
  }

  const launcherTarget = path.join(tempDir, 'slaif-launch');
  fs.copyFileSync(launcherSource, launcherTarget);
  fs.chmodSync(launcherTarget, 0o555);
  fs.cpSync(path.join(root, 'remote/launcher/lib'), path.join(tempDir, 'lib'), {
    recursive: true,
  });
  fs.cpSync(path.join(root, 'remote/launcher/templates'), path.join(tempDir, 'templates'), {
    recursive: true,
  });

  if ((fs.statSync(launcherTarget).mode & 0o111) === 0) {
    throw new Error(`generated launcher is not executable: ${launcherTarget}`);
  }

  return {
    launcherSource,
    launcherTarget,
  };
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
  payloadId,
  descriptorPayloadId = payloadId,
  sessionId,
  tokenRegistry,
  auditLogger,
  metricsRegistry,
  readinessOptions,
  launchTokenRecord,
  relayTokenRecord,
  jobReportTokenRecord,
  relayTokenExpiresAtOverride,
  jobReportTokenExpiresAtOverride,
  relayUrl,
  username,
}) {
  const jobReports = [];
  const payloadResults = [];
  const observabilityHandler = createObservabilityHttpHandler({
    metricsRegistry,
    readinessOptions,
  });
  const server = http.createServer((req, res) => {
    const origin = `http://${host}:${server.address().port}`;
    const url = new URL(req.url, origin);

    observabilityHandler(req, res).then((handled) => {
      if (!handled) {
        routeRequest();
      }
    }).catch((error) => {
      if (res.headersSent || res.writableEnded) {
        return;
      }
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: error.code || 'observability_error'}));
    });

    function metric(name, labels = {}, value = 1) {
      metricsRegistry?.increment?.(name, labels, value);
    }

    function observe(name, labels = {}, value = 0) {
      metricsRegistry?.observeHistogram?.(name, labels, value);
    }

    function audit(event, fields = {}) {
      auditLogger?.event?.(event, fields);
    }

    function routeRequest() {

    if (url.pathname === '/launcher.html') {
      const extensionId = url.searchParams.get('extensionId') || '';
      const launchToken = launchTokenRecord.token;
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
      payloadId: ${JSON.stringify(payloadId)},
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
      const startedAt = Date.now();
      audit('descriptor.requested', {sessionId, hpc, outcome: 'started'});
      metric('slaif_descriptor_requests_total', {route: 'session_descriptor', outcome: 'requested'});
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      try {
        tokenRegistry.consumeToken(bearer, {
          scope: TOKEN_SCOPES.LAUNCH,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
      } catch (_error) {
        audit('descriptor.rejected', {sessionId, hpc, outcome: 'rejected', reason: 'unauthorized'});
        metric('slaif_descriptor_rejections_total', {
          route: 'session_descriptor',
          outcome: 'rejected',
          reason: 'unauthorized',
        });
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      audit('descriptor.issued', {sessionId, hpc, outcome: 'issued'});
      observe('slaif_descriptor_duration_seconds', {route: 'session_descriptor'}, (Date.now() - startedAt) / 1000);
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
        payloadId: descriptorPayloadId,
        relayUrl,
        relayToken: relayTokenRecord.token,
        relayTokenExpiresAt: relayTokenExpiresAtOverride || relayTokenRecord.expiresAt,
        jobReportToken: jobReportTokenRecord.token,
        jobReportTokenExpiresAt: jobReportTokenExpiresAtOverride || jobReportTokenRecord.expiresAt,
        usernameHint: username,
        mode: 'launch',
      }));
      return;
    }

    if (url.pathname === `/api/connect/session/${encodeURIComponent(sessionId)}/job-report`) {
      const startedAt = Date.now();
      audit('jobReport.received', {sessionId, hpc, outcome: 'received'});
      if (req.method !== 'POST') {
        audit('jobReport.rejected', {sessionId, hpc, outcome: 'rejected', reason: 'method_not_allowed'});
        metric('slaif_job_report_rejections_total', {
          route: 'job_report',
          outcome: 'rejected',
          reason: 'method_not_allowed',
        });
        res.writeHead(405, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'method_not_allowed'}));
        return;
      }
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      try {
        tokenRegistry.validateToken(bearer, {
          scope: TOKEN_SCOPES.JOB_REPORT,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
      } catch (_error) {
        audit('jobReport.rejected', {sessionId, hpc, outcome: 'rejected', reason: 'unauthorized'});
        metric('slaif_job_report_rejections_total', {
          route: 'job_report',
          outcome: 'rejected',
          reason: 'unauthorized',
        });
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
            'workloadToken',
          ]) {
            if (Object.hasOwn(report, forbidden)) {
              throw new Error(`forbidden report field ${forbidden}`);
            }
          }
        } catch (error) {
          audit('jobReport.rejected', {
            sessionId,
            hpc,
            outcome: 'rejected',
            reason: error.message || 'invalid_report',
          });
          metric('slaif_job_report_rejections_total', {
            route: 'job_report',
            outcome: 'rejected',
            reason: 'invalid_report',
          });
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: error.message || 'invalid_report'}));
          return;
        }
        tokenRegistry.consumeToken(bearer, {
          scope: TOKEN_SCOPES.JOB_REPORT,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
        jobReports.push(report);
        audit('jobReport.accepted', {sessionId, hpc, outcome: 'accepted'});
        metric('slaif_job_reports_total', {
          route: 'job_report',
          outcome: 'accepted',
          scheduler: report.scheduler || 'none',
        });
        observe('slaif_job_report_duration_seconds', {route: 'job_report'}, (Date.now() - startedAt) / 1000);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ok: true}));
      });
      return;
    }

    if (url.pathname === `/api/connect/session/${encodeURIComponent(sessionId)}/payload-result`) {
      const startedAt = Date.now();
      audit('payloadResult.received', {sessionId, hpc, outcome: 'received'});
      if (req.method !== 'POST') {
        audit('payloadResult.rejected', {sessionId, hpc, outcome: 'rejected', reason: 'method_not_allowed'});
        res.writeHead(405, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'method_not_allowed'}));
        return;
      }
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      try {
        tokenRegistry.validateToken(bearer, {
          scope: TOKEN_SCOPES.JOB_REPORT,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
      } catch (_error) {
        audit('payloadResult.rejected', {sessionId, hpc, outcome: 'rejected', reason: 'unauthorized'});
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) {
          req.destroy();
        }
      });
      req.on('end', () => {
        let payloadResult;
        try {
          payloadResult = validatePayloadResult(JSON.parse(body));
          if (payloadResult.sessionId !== sessionId ||
              payloadResult.hpc !== hpc ||
              payloadResult.payloadId !== payloadId) {
            throw new Error('payload result binding mismatch');
          }
        } catch (error) {
          audit('payloadResult.rejected', {
            sessionId,
            hpc,
            outcome: 'rejected',
            reason: error.code || error.message || 'invalid_payload_result',
          });
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: error.code || 'invalid_payload_result'}));
          return;
        }
        tokenRegistry.consumeToken(bearer, {
          scope: TOKEN_SCOPES.JOB_REPORT,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
        payloadResults.push(payloadResult);
        audit('payloadResult.accepted', {sessionId, hpc, outcome: 'accepted'});
        metric('slaif_payload_results_total', {
          route: 'payload_result',
          outcome: 'accepted',
          payloadId: payloadResult.payloadId,
          status: payloadResult.status,
        });
        observe('slaif_payload_result_duration_seconds', {route: 'payload_result'}, (Date.now() - startedAt) / 1000);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ok: true}));
      });
      return;
    }

    if (url.pathname === '/api/test/descriptor-replay') {
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      try {
        tokenRegistry.consumeToken(bearer, {
          scope: TOKEN_SCOPES.LAUNCH,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true}));
      } catch (error) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: false, error: error.code || 'unauthorized'}));
      }
      return;
    }

    if (url.pathname === '/api/test/job-report-replay') {
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      try {
        tokenRegistry.consumeToken(bearer, {
          scope: TOKEN_SCOPES.JOB_REPORT,
          sessionId,
          hpc,
          metadata: {payloadId},
        });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true}));
      } catch (error) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: false, error: error.code || 'unauthorized'}));
      }
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

    if (url.pathname === '/api/test/payload-results') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({payloadResults}));
      return;
    }

    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('not found\n');
    }
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
    payloadResults,
    auditEvents: auditLogger?.sink?.events,
    close: () => closeHttpServer(server),
  };
}

export async function startExtensionDevStack(options = {}) {
  const root = options.root || defaultRoot;
  const buildDir = options.buildDir || path.join(root, 'build/extension');
  const hpc = options.hpc || DEFAULT_DEV_HPC;
  const payloadId = options.payloadId || DEFAULT_PAYLOAD_ID;
  const hostKeyAlias = options.hostKeyAlias || DEFAULT_HOST_KEY_ALIAS;
  const expectedOutput = options.expectedOutput || DEFAULT_EXPECTED_OUTPUT;
  const expectedJobId = options.expectedJobId || DEFAULT_EXPECTED_JOB_ID;
  const sessionId = options.sessionId || `sess_local_dev_${crypto.randomBytes(8).toString('hex')}`;
  const password = options.password || `slaif-${crypto.randomBytes(6).toString('base64url')}`;
  const imageTag = options.imageTag || `slaif-extension-dev-sshd-${process.pid}-${Date.now()}`;
  const policyKeyId = options.policyKeyId || 'slaif-policy-local-dev';
  const logger = options.logger || defaultLogger(options.quiet);
  const auditSink = options.auditSink || createMemoryAuditSink();
  const auditLogger = options.auditLogger || createAuditLogger({
    sink: auditSink,
    environment: 'development',
    includeSessionId: true,
  });
  const metricsRegistry = options.metricsRegistry || createMetricsRegistry({
    environment: 'development',
  });
  const tokenRegistry = options.tokenRegistry || createTokenRegistry({
    auditLogger,
    metricsRegistry,
  });
  const rateLimiter = options.rateLimiter || createRateLimiter({mode: 'memory'});
  const tokenTtlMs = options.tokenTtlMs || 5 * 60 * 1000;

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
    prepareLauncherKeysDirectory({root, tempDir});
    fs.writeFileSync(
        path.join(tempDir, 'session-intent.json'),
        `${JSON.stringify(localIntentForPayload({sessionId, hpc, payloadId}), null, 2)}\n`,
    );
    fs.writeFileSync(
        path.join(tempDir, 'slurm-profiles.json'),
        `${JSON.stringify(localProfileCatalog(payloadId), null, 2)}\n`,
    );
    const fakeSbatch = path.join(tempDir, 'sbatch');
    fs.writeFileSync(fakeSbatch, [
      '#!/bin/sh',
      'set -eu',
      'out=""',
      'script=""',
      'for arg in "$@"; do',
      '  case "$arg" in',
      "    *';'*|*'`'*|*'$('*|*'|'*|*'&'*) exit 64 ;;",
      '  esac',
      'done',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --output) out="$2"; shift 2 ;;',
      '    --output=*) out="${1#--output=}"; shift ;;',
      '    --*) shift 2 || true ;;',
      '    *) script="$1"; shift ;;',
      '  esac',
      'done',
      '[ -n "$out" ] || exit 65',
      '[ -n "$script" ] || exit 66',
      `SLAIF_SLURM_JOB_ID=${expectedJobId} SLURM_JOB_ID=${expectedJobId} /bin/sh "$script" > "$out"`,
      `printf 'Submitted batch job ${expectedJobId}\\n'`,
      '',
    ].join('\n'));
    fs.chmodSync(fakeSbatch, 0o555);
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

    try {
      run('docker', [
        'exec',
        '--user',
        'testuser',
        containerId,
        '/bin/sh',
        '-c',
        'test -x /keys/slaif-launch && /keys/slaif-launch --version >/dev/null',
      ], {cwd: root});
    } catch (error) {
      throw new Error([
        'local dev stack error: /keys/slaif-launch is not executable inside test sshd container',
        error.message,
      ].filter(Boolean).join('\n'));
    }

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
        devMode: false,
        tokenRegistry,
      },
      ...(options.deploymentConfig ? {
        maxAuthMessageBytes: options.deploymentConfig.relayMaxAuthBytes,
        unauthenticatedTimeoutMs: options.deploymentConfig.relayUnauthTimeoutMs,
        idleTimeoutMs: options.deploymentConfig.relayIdleTimeoutMs,
        maxConnectionMs: options.deploymentConfig.relayAbsoluteTimeoutMs,
      } : {}),
      logger,
      auditLogger,
      metricsRegistry,
    });
    await relay.listen({host: '127.0.0.1', port: 0});
    const relayPort = relay.address().port;
    const relayUrl = `ws://127.0.0.1:${relayPort}/ssh-relay`;

    const launchTokenRecord = tokenRegistry.issueToken({
      token: options.launchToken,
      scope: options.launchTokenScope || TOKEN_SCOPES.LAUNCH,
      sessionId,
      hpc,
      ttlMs: tokenTtlMs,
      maxUses: 1,
      metadata: {payloadId},
    });
    const relayTokenRecord = tokenRegistry.issueToken({
      token: options.relayToken,
      scope: options.relayTokenScope || TOKEN_SCOPES.RELAY,
      sessionId,
      hpc,
      ttlMs: tokenTtlMs,
      maxUses: 1,
      metadata: {
        userId: 'local-dev-user',
      },
    });
    const jobReportTokenRecord = tokenRegistry.issueToken({
      token: options.jobReportToken,
      scope: options.jobReportTokenScope || TOKEN_SCOPES.JOB_REPORT,
      sessionId,
      hpc,
      ttlMs: tokenTtlMs,
      maxUses: 2,
      metadata: {payloadId},
    });

    webApi = await startMockSlaifWebApiServer({
      hpc,
      payloadId,
      descriptorPayloadId: options.descriptorPayloadIdOverride || payloadId,
      sessionId,
      tokenRegistry,
      auditLogger,
      metricsRegistry,
      readinessOptions: {
        deploymentConfig: {
          env: 'development',
          auditLogMode: 'memory',
          metricsMode: 'prometheus',
          signedPolicyFile: 'build/extension/config/hpc_policy.local.json',
          policyTrustRootsFile: 'build/extension/config/policy_trust_roots.local.json',
        },
        tokenStore: {
          healthCheck: () => ({
            ok: true,
            mode: 'memory',
            durable: false,
            sharedAcrossInstances: false,
          }),
        },
        rateLimiter,
        relayAllowlist: {
          [hpc]: {
            host: '127.0.0.1',
            port: sshdPort,
          },
        },
        auditLogger,
        auditSink,
        metricsRegistry,
        requireSignedPolicy: true,
        requireTrustRoots: true,
      },
      launchTokenRecord,
      relayTokenRecord,
      jobReportTokenRecord,
      relayTokenExpiresAtOverride: options.expiredRelayTokenDescriptor ?
        new Date(Date.now() - 60000).toISOString() :
        undefined,
      jobReportTokenExpiresAtOverride: options.expiredJobReportTokenDescriptor ?
        new Date(Date.now() - 60000).toISOString() :
        undefined,
      relayUrl,
      username: 'testuser',
    });

    const runtimeConfig = {
      mode: 'local-dev',
      hpc,
      payloadId,
      apiBaseUrl: webApi.apiBaseUrl,
      launcherUrl: webApi.launcherUrl,
      webOrigin: webApi.webOrigin,
      launchToken: launchTokenRecord.token,
      relayUrl,
      relayToken: relayTokenRecord.token,
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
      allowedPayloads: buildDefaultPayloadCatalog(),
      hosts: {
        [hpc]: {
          displayName: 'Local development test sshd',
          sshHost: '127.0.0.1',
          sshPort: 22,
          hostKeyAlias,
          knownHosts: [knownHostsLine],
          remoteCommandTemplate: options.noSlurmJobOutput ?
            '/bin/sh -lc "printf \'SLAIF session ${SESSION_ID}\\n\'"' :
            `PATH=/keys:$PATH /keys/slaif-launch --session ${'${SESSION_ID}'} --intent-file /keys/session-intent.json --profile-file /keys/slurm-profiles.json --wait-result`,
          allowInteractiveTerminal: false,
          allowedPayloadIds: options.allowedPayloadIds || [payloadId],
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
    if (options.tamperPayloadCatalog) {
      signedPolicy.payload.allowedPayloads[payloadId].maxRuntimeSeconds = 999;
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
      tokenRegistry,
      auditSink,
      auditLogger,
      metricsRegistry,
      rateLimiter,
      launchToken: launchTokenRecord.token,
      relayToken: relayTokenRecord.token,
      jobReportToken: jobReportTokenRecord.token,
      launchTokenRecord,
      relayTokenRecord,
      jobReportTokenRecord,
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
