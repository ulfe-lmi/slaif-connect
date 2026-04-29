import {
  buildRemoteCommand,
  requireLaunchableKnownHosts,
} from './slaif_policy.js';

function defaultPluginExecutable() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL('plugin/wasm/ssh.wasm');
  }
  return '../plugin/wasm/ssh.wasm';
}

export function buildSshArgs({policyHost, username, command}) {
  if (!policyHost || typeof policyHost !== 'object') {
    throw new Error('policyHost is required');
  }
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
    throw new Error('invalid SSH username');
  }
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('remote command is required');
  }

  return [
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'CheckHostIP=no',
    '-o', `HostKeyAlias=${policyHost.hostKeyAlias}`,
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'ClearAllForwardings=yes',
    '-p', String(policyHost.sshPort),
    '-l', username,
    policyHost.sshHost,
    command,
  ];
}

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      data.set(key, String(value));
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

async function createTerminal(container) {
  const {hterm} = await import('../vendor/libapps/hterm/index.js');
  await hterm.initPromise;

  const terminal = new hterm.Terminal();
  terminal.decorate(container);
  terminal.installKeyboard();
  terminal.io.println('SLAIF Connect browser OpenSSH/WASM prototype');
  return terminal;
}

export async function startBrowserSshSession({
  policyHost,
  relay,
  username,
  sessionId,
  terminalElement,
  executable = defaultPluginExecutable(),
  trace = false,
}) {
  const knownHosts = requireLaunchableKnownHosts(policyHost);
  const command = buildRemoteCommand(policyHost, sessionId);
  const argv = buildSshArgs({policyHost, username, command});
  const terminal = await createTerminal(terminalElement);

  const {SshSubproc} = await import('../vendor/libapps/nassh/js/nassh_subproc_ssh.js');

  const program = new SshSubproc({
    executable,
    argv,
    environ: {
      TERM: 'xterm-256color',
    },
    terminal,
    trace,
    authAgent: null,
    authAgentAppID: '',
    relay,
    secureInput: (...args) => terminal.io.secureInput(...args),
    captureStdout: true,
    isSftp: false,
    sftpClient: null,
    syncStorage: createMemoryStorage(),
    knownHosts,
  });

  terminal.io.println(`Connecting to ${policyHost.hostKeyAlias} through SLAIF relay...`);
  await program.init();
  const exitCode = await program.run();
  terminal.io.println(`OpenSSH/WASM exited with code ${exitCode}`);

  return {
    exitCode,
    argv,
    command,
  };
}
