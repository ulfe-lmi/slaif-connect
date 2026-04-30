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

async function createTerminal(container, onOutput) {
  const {hterm} = await import('../vendor/libapps/hterm/index.js');
  await hterm.initPromise;

  const terminal = new hterm.Terminal();
  terminal.decorate(container);
  terminal.installKeyboard();

  if (onOutput) {
    const originalPrint = terminal.io.print.bind(terminal.io);
    terminal.io.print = (string) => {
      onOutput(String(string));
      return originalPrint(string);
    };
  }

  terminal.io.secureInput = (prompt, maxLength, echo) => {
    return new Promise((resolve) => {
      const panel = document.createElement('div');
      panel.dataset.slaifSecureInput = 'true';
      panel.style.padding = '12px 16px';
      panel.style.borderTop = '1px solid #333';
      panel.style.background = '#181818';

      const label = document.createElement('label');
      label.textContent = String(prompt || '').trim() || 'SSH authentication';
      label.style.display = 'block';
      label.style.marginBottom = '8px';

      const input = document.createElement('input');
      input.type = echo ? 'text' : 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.maxLength = Math.max(1, Number(maxLength || 1024) - 1);
      input.ariaLabel = label.textContent;
      input.style.width = 'min(420px, 90vw)';

      panel.append(label, input);
      container.after(panel);

      const cleanup = (value) => {
        panel.remove();
        terminal.focus();
        resolve(value);
      };
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          cleanup(input.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cleanup('');
        }
      }, true);
      setTimeout(() => input.focus());
    });
  };

  terminal.io.println('SLAIF Connect browser OpenSSH/WASM prototype');
  return terminal;
}

function normalizeExitResult(result) {
  if (typeof result === 'number') {
    return {
      exitCode: result,
      message: '',
    };
  }
  if (result && typeof result === 'object') {
    if (typeof result.status === 'number') {
      return {
        exitCode: result.status,
        message: result.message || '',
      };
    }
    if (typeof result.signal === 'number') {
      return {
        exitCode: 128 + result.signal,
        message: result.message || `terminated by signal ${result.signal}`,
      };
    }
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
      message: result.message || JSON.stringify(result),
    };
  }
  return {
    exitCode: 1,
    message: String(result),
  };
}

export async function startBrowserSshSession({
  policyHost,
  relay,
  username,
  sessionId,
  terminalElement,
  executable = defaultPluginExecutable(),
  trace = false,
  onStatus = () => {},
  onOutput = () => {},
  maxCapturedOutputBytes = 64 * 1024,
}) {
  const knownHosts = requireLaunchableKnownHosts(policyHost);
  const command = buildRemoteCommand(policyHost, sessionId);
  const argv = buildSshArgs({policyHost, username, command});
  onStatus('ssh-starting', 'Initializing hterm and OpenSSH/WASM');
  let capturedOutput = '';
  const captureOutput = (text) => {
    capturedOutput += String(text);
    if (capturedOutput.length > maxCapturedOutputBytes) {
      capturedOutput = capturedOutput.slice(capturedOutput.length - maxCapturedOutputBytes);
    }
    onOutput(text);
  };
  const terminal = await createTerminal(terminalElement, captureOutput);

  const {SshSubproc} = await import('../vendor/libapps/nassh/js/nassh_subproc_ssh.js');

  onStatus('ssh-starting', 'SSH process started');
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
  onStatus('relay-connecting', 'Relay connecting');
  await program.init();
  onStatus('authenticating', 'Host key verification and authentication in progress');
  const rawExitResult = await program.run();
  const {exitCode, message} = normalizeExitResult(rawExitResult);
  terminal.io.println(`OpenSSH/WASM exited with code ${exitCode}`);
  if (message) {
    terminal.io.println(`OpenSSH/WASM message: ${message}`);
  }
  onStatus(exitCode === 0 ? 'completed' : 'failed',
      exitCode === 0 ? 'Command completed' : `OpenSSH/WASM exited with code ${exitCode}`);

  return {
    exitCode,
    rawExitResult,
    argv,
    command,
    output: capturedOutput,
  };
}
