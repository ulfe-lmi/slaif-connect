import {
  buildRemoteCommand,
  loadHpcPolicy,
  requireKnownHpcAlias,
  validateSessionId,
} from './slaif_policy.js';
import {SlaifRelay} from './slaif_relay.js';
import {parseSlurmJobId} from './job_output_parser.js';

const statusEl = document.getElementById('status');
const terminalEl = document.getElementById('terminal');

function status(text) {
  statusEl.textContent = text;
}

function print(text) {
  terminalEl.textContent += `${text}\n`;
  terminalEl.scrollTop = terminalEl.scrollHeight;
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
  // TODO: Wire this into the vendored upstream libapps/wassh/nassh runtime.
  // Desired behavior:
  //
  // 1. Initialize hterm for terminal UI.
  // 2. Start the OpenSSH WASM client.
  // 3. Configure the JS/WASI socket layer to use `relay.openSocket(host, port)`.
  // 4. Pass OpenSSH args equivalent to:
  //
  //    -o StrictHostKeyChecking=yes
  //    -o CheckHostIP=no
  //    -o HostKeyAlias=<policyHost.hostKeyAlias>
  //    -o ForwardAgent=no
  //    -o ForwardX11=no
  //    -o ClearAllForwardings=yes
  //    -p <policyHost.sshPort>
  //    <user>@<policyHost.sshHost>
  //    <fixed remote command>
  //
  // 5. Feed known_hosts from policyHost.knownHosts.
  // 6. Capture stdout/stderr for job-id parsing.
  //
  // This starter deliberately leaves the final upstream integration as a clear
  // boundary rather than patching nassh_command_instance.js.

  const command = buildRemoteCommand(policyHost, sessionId);

  print('Prepared SSH-over-relay session:');
  print(`  target alias: ${policyHost.hostKeyAlias}`);
  print(`  target host:  ${policyHost.sshHost}:${policyHost.sshPort}`);
  print(`  relay URL:    ${relay.relayUrl}`);
  print(`  command:      ${command}`);
  print('');
  print('TODO: connect this boundary to upstream libapps/wassh OpenSSH runtime.');

  // Example output parser check for local development.
  const example = 'Submitted batch job 123456';
  const jobId = parseSlurmJobId(example);
  print(`Parser smoke test: ${example} → job id ${jobId}`);
}

async function main() {
  status('Loading pending SLAIF session…');
  const pending = await getPendingSession();
  if (!pending) {
    throw new Error('No pending SLAIF session found. Start from the SLAIF web page.');
  }

  validateSessionId(pending.sessionId);

  status('Loading HPC policy…');
  const policy = await loadHpcPolicy();
  const policyHost = requireKnownHpcAlias(policy, pending.hpc);

  status(`Preparing ${policyHost.displayName || pending.hpc}…`);
  const descriptor = validateDescriptor(await fetchSessionDescriptor(policy, pending.sessionId), pending);

  const relay = new SlaifRelay({
    policyHost,
    relayUrl: policy.relay.url,
    relayToken: descriptor.relayToken,
  });

  status('Ready to start SSH over relay');
  await startSshOverRelay({policyHost, relay, sessionId: pending.sessionId});
}

main().catch((error) => {
  console.error(error);
  status('SLAIF Connect failed');
  print(`ERROR: ${error.message || error}`);
});
