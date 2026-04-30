import {
  buildDevelopmentPolicy,
  buildRemoteCommand,
  loadHpcPolicy,
  requireKnownHpcAlias,
  validateSessionId,
} from './slaif_policy.js';
import {SlaifRelay} from './slaif_relay.js';
import {startBrowserSshSession} from './slaif_ssh_client.js';
import {parseSlurmJobId} from './job_output_parser.js';

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

async function fetchSessionDescriptor(policy, sessionId) {
  const template = policy.relay.sessionDescriptorUrlTemplate;
  const url = template.replace('${SESSION_ID}', encodeURIComponent(sessionId));

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {'Accept': 'application/json'},
  });

  if (!response.ok) {
    throw new Error(`session descriptor request failed: ${response.status}`);
  }

  return response.json();
}

function validateDescriptor(descriptor, pending) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('empty session descriptor');
  }
  if (descriptor.sessionId !== pending.sessionId) {
    throw new Error('session descriptor mismatch');
  }
  if (descriptor.hpc !== pending.hpc) {
    throw new Error('HPC alias mismatch in session descriptor');
  }
  if (typeof descriptor.relayToken !== 'string' || descriptor.relayToken.length < 16) {
    throw new Error('missing relay token');
  }
  return descriptor;
}

async function startSshOverRelay({policyHost, relay, sessionId}) {
  const command = buildRemoteCommand(policyHost, sessionId);

  print('Prepared SSH-over-relay session:');
  print(`  target alias: ${policyHost.hostKeyAlias}`);
  print(`  target host:  ${policyHost.sshHost}:${policyHost.sshPort}`);
  print(`  relay URL:    ${relay.relayUrl}`);
  print(`  command:      ${command}`);
  print('Browser OpenSSH/WASM is not started for externally launched production sessions yet.');
  print('Use the local development stack for the browser relay prototype.');

  // Example output parser check for local development.
  const example = 'Submitted batch job 123456';
  const jobId = parseSlurmJobId(example);
  print(`Parser smoke test: ${example} → job id ${jobId}`);
}

async function startDevelopmentSession(runtimeConfig) {
  setStatusState('loading-config', 'Loading local development SSH policy...');
  const policy = buildDevelopmentPolicy(runtimeConfig);
  const policyHost = requireKnownHpcAlias(policy, runtimeConfig.hpc);
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

  validateSessionId(pending.sessionId);

  setStatusState('loading-config', 'Loading HPC policy...');
  const policy = await loadHpcPolicy();
  const policyHost = requireKnownHpcAlias(policy, pending.hpc);

  setStatusState('loading-config', `Preparing ${policyHost.displayName || pending.hpc}...`);
  const descriptor = validateDescriptor(await fetchSessionDescriptor(policy, pending.sessionId), pending);

  const relay = new SlaifRelay({
    policyHost,
    relayUrl: policy.relay.url,
    relayToken: descriptor.relayToken,
  });

  setStatusState('idle', 'Ready to start SSH over relay');
  await startSshOverRelay({policyHost, relay, sessionId: pending.sessionId});
}

main().catch((error) => {
  console.error(error);
  setStatusState('failed', 'SLAIF Connect failed');
  print(`ERROR: ${error.message || error}`);
});
