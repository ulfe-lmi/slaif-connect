import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRelayServer} from '../server/relay/relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, '..');

export const DEFAULT_DEV_TOKEN = 'dev-token-test-sshd';
export const DEFAULT_DEV_HPC = 'test-sshd';
export const DEFAULT_HOST_KEY_ALIAS = 'test-sshd';
export const DEFAULT_EXPECTED_OUTPUT = 'slaif-browser-relay-ok';

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

export async function startExtensionDevStack(options = {}) {
  const root = options.root || defaultRoot;
  const buildDir = options.buildDir || path.join(root, 'build/extension');
  const token = options.relayToken || DEFAULT_DEV_TOKEN;
  const hpc = options.hpc || DEFAULT_DEV_HPC;
  const hostKeyAlias = options.hostKeyAlias || DEFAULT_HOST_KEY_ALIAS;
  const expectedOutput = options.expectedOutput || DEFAULT_EXPECTED_OUTPUT;
  const sessionId = options.sessionId || `sess_local_dev_${crypto.randomBytes(8).toString('hex')}`;
  const password = options.password || `slaif-${crypto.randomBytes(6).toString('base64url')}`;
  const imageTag = options.imageTag || `slaif-extension-dev-sshd-${process.pid}-${Date.now()}`;
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
    if (containerId) {
      runQuiet('docker', ['rm', '-f', containerId], {cwd: root});
      containerId = null;
    }
    runQuiet('docker', ['rmi', '-f', imageTag], {cwd: root});
    const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
    fs.rmSync(configPath, {force: true});
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  try {
    const hostKey = path.join(tempDir, 'ssh_host_ed25519_key');
    const wrongHostKey = path.join(tempDir, 'wrong_ssh_host_ed25519_key');
    const clientKey = path.join(tempDir, 'unused_client_ed25519');
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

    const runtimeConfig = {
      mode: 'local-dev',
      hpc,
      relayUrl: `ws://127.0.0.1:${relayPort}/ssh-relay`,
      relayToken: token,
      username: 'testuser',
      password,
      sessionId,
      sshHost: '127.0.0.1',
      sshPort: 22,
      hostKeyAlias,
      knownHosts: [
        publicKeyLine(options.wrongKnownHost ? `${wrongHostKey}.pub` : `${hostKey}.pub`, hostKeyAlias),
      ],
      remoteCommandTemplate: `SESSION_ID=\${SESSION_ID} printf ${expectedOutput}`,
      expectedOutput,
    };

    const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`);

    return {
      root,
      buildDir,
      tempDir,
      imageTag,
      containerId,
      sshdPort,
      relay,
      relayPort,
      configPath,
      runtimeConfig,
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
  console.log(`Test sshd container: ${stack.containerId}`);
  console.log(`Generated extension config: ${stack.configPath}`);
  console.log(`Development password for testuser: ${stack.password}`);
  console.log('');
  console.log('Manual browser steps:');
  console.log('1. Load build/extension as an unpacked Chrome extension.');
  console.log('2. Open the extension popup.');
  console.log('3. Click "Open local dev session".');
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
