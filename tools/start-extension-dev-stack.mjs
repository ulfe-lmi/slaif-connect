import {spawn, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {createRelayServer} from '../server/relay/relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const token = 'dev-token-test-sshd';
const hpc = 'test-sshd';
const hostKeyAlias = 'test-sshd';
const sessionId = `sess_local_dev_${crypto.randomBytes(8).toString('hex')}`;
const expectedOutput = 'slaif-browser-relay-ok';
const password = `slaif-${crypto.randomBytes(6).toString('base64url')}`;
const imageTag = `slaif-extension-dev-sshd-${process.pid}-${Date.now()}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
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

function requireCommand(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error(`missing prerequisite: ${command}`);
  }
}

function dockerPort(containerId) {
  const result = run('docker', ['port', containerId, '22/tcp']);
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

async function main() {
  for (const command of ['docker', 'ssh-keygen']) {
    requireCommand(command);
  }

  const buildDir = path.join(root, 'build/extension');
  if (!fs.existsSync(path.join(buildDir, 'manifest.json'))) {
    throw new Error('build/extension is missing. Run npm run build:extension first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-extension-dev-'));
  let containerId = null;
  let relay = null;

  async function cleanup() {
    if (relay) {
      await relay.close().catch(() => {});
    }
    if (containerId) {
      spawnSync('docker', ['rm', '-f', containerId], {stdio: 'ignore'});
    }
    spawnSync('docker', ['rmi', '-f', imageTag], {stdio: 'ignore'});
    fs.rmSync(tempDir, {recursive: true, force: true});
  }

  process.once('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  try {
    const hostKey = path.join(tempDir, 'ssh_host_ed25519_key');
    const clientKey = path.join(tempDir, 'unused_client_ed25519');
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey]);
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', clientKey]);
    fs.writeFileSync(path.join(tempDir, 'authorized_keys'),
        fs.readFileSync(`${clientKey}.pub`, 'utf8'));

    run('docker', ['build', '-t', imageTag, path.join(root, 'tests/relay/sshd')]);
    containerId = run('docker', [
      'run',
      '-d',
      '-p', '127.0.0.1::22',
      '-v', `${tempDir}:/keys:ro`,
      '-e', `SLAIF_TEST_PASSWORD=${password}`,
      imageTag,
    ]).stdout.trim();

    const sshdPort = dockerPort(containerId);
    await waitForPort(sshdPort);

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
        publicKeyLine(`${hostKey}.pub`, hostKeyAlias),
      ],
      remoteCommandTemplate: `SESSION_ID=\${SESSION_ID} /bin/printf ${expectedOutput}`,
      expectedOutput,
    };

    const configPath = path.join(buildDir, 'config/dev_runtime.local.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`);

    const server = http.createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('SLAIF extension development stack is running.\n');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    console.log('SLAIF extension development stack is running.');
    console.log(`Relay URL: ${runtimeConfig.relayUrl}`);
    console.log(`Test sshd container: ${containerId}`);
    console.log(`Generated extension config: ${configPath}`);
    console.log(`Development password for testuser: ${password}`);
    console.log('');
    console.log('Manual browser steps:');
    console.log('1. Load build/extension as an unpacked Chrome extension.');
    console.log('2. Open the extension popup.');
    console.log('3. Click "Open local dev session".');
    console.log(`4. When OpenSSH asks for testuser password, enter: ${password}`);
    console.log(`5. Expected command output: ${expectedOutput}`);
    console.log('');
    console.log('Press Ctrl-C to stop the relay and remove the container.');

    await new Promise(() => {});
  } catch (error) {
    await cleanup();
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
