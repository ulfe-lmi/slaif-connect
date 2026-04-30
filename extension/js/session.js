import {
  evaluateAcceptedPolicyRollback,
  buildRemoteCommand,
  loadVerifiedHpcPolicy,
  policyAllowsApiBaseUrl,
  policyAllowsRelayUrl,
  requireKnownHpcAlias,
  validateSessionId,
} from './slaif_policy.js';
import {
  buildDescriptorFetchRequest,
  validateLaunchMessage,
  validateSessionDescriptor,
} from './slaif_session_descriptor.js';
import {SlaifRelay} from './slaif_relay.js';
import {startBrowserSshSession} from './slaif_ssh_client.js';
import {parseSchedulerJobSubmission} from './job_output_parser.js';
import {postJobReport} from './slaif_job_reporter.js';

const statusEl = document.getElementById('status');
const terminalEl = document.getElementById('terminal');
const logEl = document.getElementById('log');
const capturedOutputEl = document.getElementById('captured-output');

function setStatusState(state, text) {
  document.body.dataset.slaifStatus = state;
  statusEl.textContent = text;
  console.info(`SLAIF status: ${state}: ${text}`);
}

function status(text) {
  setStatusState('working', text);
}

function print(text) {
  logEl.textContent += `${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function appendCapturedOutput(text) {
  capturedOutputEl.hidden = false;
  capturedOutputEl.textContent += text;
  capturedOutputEl.scrollTop = capturedOutputEl.scrollHeight;
}

function normalizeTerminalText(text) {
  return String(text).replace(/\r/g, '');
}

function getPendingSession() {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get('pendingSlaifSession', (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items.pendingSlaifSession || null);
    });
  });
}

async function fetchOptionalJson(url) {
  let response;
  try {
    response = await fetch(url, {cache: 'no-store'});
  } catch (error) {
    if (String(error?.message || error).includes('Failed to fetch')) {
      return null;
    }
    throw error;
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

async function loadDevelopmentRuntimeConfig() {
  if (!globalThis.chrome?.runtime?.getURL) {
    return null;
  }
  return fetchOptionalJson(chrome.runtime.getURL('config/dev_runtime.local.json'));
}

function isLocalDevOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  } catch (_e) {
    return false;
  }
}

function apiBaseUrlFromPolicy(policy) {
  if (Array.isArray(policy.allowedApiOrigins) && policy.allowedApiOrigins.length > 0) {
    return `${policy.allowedApiOrigins[0]}/`;
  }
  if (policy.relay?.apiBaseUrl) {
    return policy.relay.apiBaseUrl;
  }
  if (policy.relay?.sessionDescriptorUrlTemplate) {
    const templateUrl = new URL(policy.relay.sessionDescriptorUrlTemplate);
    const marker = '/api/connect/session/';
    if (templateUrl.pathname.includes(marker)) {
      templateUrl.pathname = templateUrl.pathname.slice(0, templateUrl.pathname.indexOf(marker)) || '/';
      templateUrl.search = '';
      templateUrl.hash = '';
      return templateUrl.href;
    }
  }
  throw new Error('SLAIF API base URL is not configured');
}

function extensionConfigUrl(path) {
  return chrome.runtime.getURL(`config/${path}`);
}

async function loadPolicyForContext({allowLocalDev = false} = {}) {
  if (allowLocalDev) {
    return loadVerifiedHpcPolicy({
      policyUrl: extensionConfigUrl('hpc_policy.local.json'),
      trustRootsUrl: extensionConfigUrl('policy_trust_roots.local.json'),
      allowLocalDev: true,
    });
  }
  return loadVerifiedHpcPolicy();
}

function getAcceptedPolicyState() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('acceptedSignedHpcPolicy', (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items.acceptedSignedHpcPolicy || null);
    });
  });
}

function setAcceptedPolicyState(record) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({acceptedSignedHpcPolicy: record}, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function rememberProductionPolicy({policy, envelope, fingerprint}, {allowLocalDev = false} = {}) {
  if (allowLocalDev) {
    return;
  }
  const record = {
    policyId: policy.policyId,
    sequence: policy.sequence,
    keyId: envelope.keyId,
    fingerprint,
    acceptedAt: new Date().toISOString(),
  };
  evaluateAcceptedPolicyRollback(record, await getAcceptedPolicyState());
  await setAcceptedPolicyState(record);
}

async function fetchSessionDescriptor(pending, apiBaseUrl) {
  const {url, options} = buildDescriptorFetchRequest(pending, apiBaseUrl);
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`session descriptor request failed: ${response.status}`);
  }

  return response.json();
}

async function startSshOverRelay({policyHost, relay, sessionId, username, expectedOutput}) {
  const command = buildRemoteCommand(policyHost, sessionId);

  print('Prepared SSH-over-relay session:');
  print(`  target alias: ${policyHost.hostKeyAlias}`);
  print(`  target host:  ${policyHost.sshHost}:${policyHost.sshPort}`);
  print(`  relay URL:    ${relay.relayUrl}`);
  print(`  command:      ${command}`);

  logEl.hidden = true;
  terminalEl.hidden = false;
  capturedOutputEl.hidden = false;

  const result = await startBrowserSshSession({
    policyHost,
    relay,
    username,
    sessionId,
    terminalElement: terminalEl,
    onStatus: setStatusState,
    onOutput: appendCapturedOutput,
  });

  if (expectedOutput) {
    const captured = normalizeTerminalText(capturedOutputEl.textContent);
    if (!captured.includes(expectedOutput)) {
      setStatusState('failed', 'Expected remote command output was not observed');
      throw new Error(`expected output not observed: ${expectedOutput}`);
    }
  }

  if (result.exitCode !== 0) {
    setStatusState('failed', `OpenSSH/WASM exited with code ${result.exitCode}`);
    throw new Error(`OpenSSH/WASM exited with code ${result.exitCode}`);
  }

  return result;
}

async function reportSchedulerJob({apiBaseUrl, descriptor, policy, allowLocalDev, output, exitCode}) {
  setStatusState('parsing-job-output', 'Parsing scheduler job output');
  const parseResult = parseSchedulerJobSubmission(output, {scheduler: 'slurm'});
  let report;
  if (parseResult.ok) {
    print(`Submitted SLURM job ${parseResult.jobId}`);
    report = {
      scheduler: parseResult.scheduler,
      jobId: parseResult.jobId,
      status: 'submitted',
      sshExitCode: exitCode,
    };
  } else {
    print('Remote command completed, but no SLURM job ID was found');
    report = {
      status: 'job_id_not_found',
      sshExitCode: exitCode,
    };
  }

  setStatusState('reporting-job', 'Reporting job metadata to SLAIF');
  await postJobReport({
    apiBaseUrl,
    sessionId: descriptor.sessionId,
    hpc: descriptor.hpc,
    jobReportToken: descriptor.jobReportToken,
    jobReportTokenExpiresAt: descriptor.jobReportTokenExpiresAt,
    policy,
    allowLocalDev,
    report,
  });
  print('Job report sent');
  if (parseResult.ok) {
    setStatusState('completed', `Submitted SLURM job ${parseResult.jobId}`);
  } else {
    setStatusState('completed', 'Command completed without a SLURM job ID');
  }
  return {parseResult, report};
}

async function startDevelopmentSession(runtimeConfig) {
  setStatusState('loading-config', 'Loading signed local development SSH policy...');
  const {policy} = await loadPolicyForContext({allowLocalDev: true});
  const policyHost = requireKnownHpcAlias(policy, runtimeConfig.hpc);
  policyAllowsApiBaseUrl(policy, runtimeConfig.apiBaseUrl, {allowLocalDev: true});
  policyAllowsRelayUrl(policy, runtimeConfig.relayUrl, {allowLocalDev: true});
  const relay = new SlaifRelay({
    policyHost,
    relayUrl: runtimeConfig.relayUrl,
    relayToken: runtimeConfig.relayToken,
    onStatus: setStatusState,
  });

  logEl.hidden = true;
  terminalEl.hidden = false;
  capturedOutputEl.hidden = false;
  setStatusState('ssh-starting',
      `Starting browser OpenSSH/WASM prototype for ${policyHost.hostKeyAlias}...`);

  const result = await startBrowserSshSession({
    policyHost,
    relay,
    username: runtimeConfig.username,
    sessionId: runtimeConfig.sessionId,
    terminalElement: terminalEl,
    onStatus: setStatusState,
    onOutput: appendCapturedOutput,
  });

  if (runtimeConfig.expectedOutput) {
    const captured = normalizeTerminalText(capturedOutputEl.textContent);
    if (captured.includes(runtimeConfig.expectedOutput)) {
      setStatusState('completed', 'Command completed');
      console.info('Observed expected local development output.');
    } else {
      setStatusState('failed', 'Expected remote command output was not observed');
      throw new Error(`expected output not observed: ${runtimeConfig.expectedOutput}`);
    }
  }

  if (result.exitCode !== 0) {
    setStatusState('failed', `OpenSSH/WASM exited with code ${result.exitCode}`);
    throw new Error(`OpenSSH/WASM exited with code ${result.exitCode}`);
  }
}

async function main() {
  const url = new URL(globalThis.location.href);
  if (url.searchParams.get('dev') === '1') {
    setStatusState('loading-config', 'Loading local development runtime config...');
    const runtimeConfig = await loadDevelopmentRuntimeConfig();
    if (!runtimeConfig) {
      setStatusState('failed', 'Local development config not found');
      print('Run npm run build:extension and npm run dev:extension-stack, then open this page again.');
      return;
    }
    await startDevelopmentSession(runtimeConfig);
    return;
  }

  setStatusState('loading-config', 'Loading pending SLAIF session...');
  const pending = await getPendingSession();
  if (!pending) {
    throw new Error('No pending SLAIF session found. Start from the SLAIF web page.');
  }

  validateLaunchMessage(pending);
  validateSessionId(pending.sessionId);

  const devRuntimeConfig = isLocalDevOrigin(pending.origin) ?
    await loadDevelopmentRuntimeConfig() :
    null;

  setStatusState('loading-config', 'Loading extension SSH policy...');
  const verifiedPolicy = await loadPolicyForContext({allowLocalDev: Boolean(devRuntimeConfig)});
  const policy = verifiedPolicy.policy;
  await rememberProductionPolicy(verifiedPolicy, {allowLocalDev: Boolean(devRuntimeConfig)});
  const policyHost = requireKnownHpcAlias(policy, pending.hpc);
  const apiBaseUrl = devRuntimeConfig?.apiBaseUrl || apiBaseUrlFromPolicy(policy);
  policyAllowsApiBaseUrl(policy, apiBaseUrl, {allowLocalDev: Boolean(devRuntimeConfig)});

  setStatusState('loading-config', 'Fetching SLAIF session descriptor...');
  const descriptor = validateSessionDescriptor(
      await fetchSessionDescriptor(pending, apiBaseUrl),
      pending,
      policyHost,
      {allowLocalDev: Boolean(devRuntimeConfig), policy},
  );

  const relay = new SlaifRelay({
    policyHost,
    relayUrl: descriptor.relayUrl,
    relayToken: descriptor.relayToken,
    onStatus: setStatusState,
  });

  setStatusState('ssh-starting', `Starting browser OpenSSH/WASM for ${policyHost.hostKeyAlias}...`);
  const sshResult = await startSshOverRelay({
    policyHost,
    relay,
    sessionId: pending.sessionId,
    username: descriptor.usernameHint || devRuntimeConfig?.username,
    expectedOutput: devRuntimeConfig?.expectedOutput,
  });
  await reportSchedulerJob({
    apiBaseUrl,
    descriptor,
    policy,
    allowLocalDev: Boolean(devRuntimeConfig),
    output: sshResult.output || capturedOutputEl.textContent,
    exitCode: sshResult.exitCode,
  });
}

main().catch((error) => {
  console.error(error);
  setStatusState('failed', 'SLAIF Connect failed');
  print(`ERROR: ${error.message || error}`);
});
