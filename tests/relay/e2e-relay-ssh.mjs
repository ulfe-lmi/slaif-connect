import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {createRelayServer} from '../../server/relay/relay.js';
import {startWsTcpBridge} from '../../tools/ws-tcp-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const token = 'dev-token-test-sshd';
const hostAlias = 'slaif-test-sshd';
const imageTag = `slaif-relay-e2e-${process.pid}-${Date.now()}`;
const silentLogger = {
  info() {},
  error() {},
};

function requireCommand(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`missing prerequisite: ${command}`);
  }
}

function requireDockerDaemon() {
  const result = spawnSync('docker', ['info'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error([
      'missing prerequisite: docker daemon access',
      result.stderr || result.stdout,
    ].filter(Boolean).join('\n'));
  }
}

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

function runAllowFailure(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function sshKeygen(args) {
  run('ssh-keygen', args);
}

function publicKeyLine(filePath, alias) {
  const parts = fs.readFileSync(filePath, 'utf8').trim().split(/\s+/);
  return `${alias} ${parts[0]} ${parts[1]}\n`;
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

function dockerPort(containerId) {
  const result = run('docker', ['port', containerId, '22/tcp']);
  const line = result.stdout.trim().split('\n')[0];
  const match = line.match(/:(\d+)$/);
  if (!match) {
    throw new Error(`could not parse docker port output: ${result.stdout}`);
  }
  return Number(match[1]);
}

function runSsh({bridgePort, keyPath, knownHostsPath}) {
  return runAllowFailure('ssh', [
    '-p', String(bridgePort),
    '-i', keyPath,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', `HostKeyAlias=${hostAlias}`,
    '-o', 'CheckHostIP=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'LogLevel=ERROR',
    'testuser@127.0.0.1',
    'printf slaif-relay-ok',
  ], {
    timeout: 20000,
  });
}

function cleanupContainer(containerId) {
  if (containerId) {
    spawnSync('docker', ['rm', '-f', containerId], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }
}

async function main() {
  requireCommand('docker');
  requireCommand('ssh');
  requireCommand('ssh-keygen');
  requireDockerDaemon();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-relay-e2e-'));
  let containerId = null;
  let relay = null;
  let bridge = null;

  try {
    const clientKey = path.join(tmp, 'client_ed25519');
    const hostKey = path.join(tmp, 'ssh_host_ed25519_key');
    const wrongHostKey = path.join(tmp, 'wrong_host_ed25519');
    const authorizedKeys = path.join(tmp, 'authorized_keys');
    const knownHosts = path.join(tmp, 'known_hosts');
    const wrongKnownHosts = path.join(tmp, 'known_hosts_wrong');

    sshKeygen(['-t', 'ed25519', '-N', '', '-f', clientKey, '-C', 'slaif-relay-e2e-client']);
    sshKeygen(['-t', 'ed25519', '-N', '', '-f', hostKey, '-C', 'slaif-relay-e2e-host']);
    sshKeygen(['-t', 'ed25519', '-N', '', '-f', wrongHostKey, '-C', 'slaif-relay-e2e-wrong-host']);
    fs.copyFileSync(`${clientKey}.pub`, authorizedKeys);
    fs.writeFileSync(knownHosts, publicKeyLine(`${hostKey}.pub`, hostAlias));
    fs.writeFileSync(wrongKnownHosts, publicKeyLine(`${wrongHostKey}.pub`, hostAlias));

    run('docker', ['build', '-t', imageTag, 'tests/relay/sshd']);
    containerId = run('docker', [
      'run',
      '-d',
      '--rm',
      '-p', '127.0.0.1::22',
      '-v', `${tmp}:/keys:ro`,
      imageTag,
    ]).stdout.trim();

    const sshdPort = dockerPort(containerId);
    await waitForPort(sshdPort);

    relay = createRelayServer({
      allowedHosts: {
        'test-sshd': {
          host: '127.0.0.1',
          port: sshdPort,
        },
      },
      logger: silentLogger,
      tokenOptions: {
        devMode: true,
        devTokenMap: {
          [token]: {
            hpc: 'test-sshd',
            sessionId: 'sess_relay_e2e_test',
            userId: 'test-user',
          },
        },
      },
    });
    await relay.listen({host: '127.0.0.1', port: 0});
    const relayPort = relay.address().port;

    bridge = await startWsTcpBridge({
      host: '127.0.0.1',
      port: 0,
      relayUrl: `ws://127.0.0.1:${relayPort}/ssh-relay`,
      relayToken: token,
      logger: silentLogger,
    });
    const bridgePort = bridge.address().port;

    const success = runSsh({
      bridgePort,
      keyPath: clientKey,
      knownHostsPath: knownHosts,
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout, 'slaif-relay-ok');

    const hostKeyFailure = runSsh({
      bridgePort,
      keyPath: clientKey,
      knownHostsPath: wrongKnownHosts,
    });
    assert.notEqual(hostKeyFailure.status, 0, 'SSH unexpectedly succeeded with the wrong host key');
    assert.match(
      `${hostKeyFailure.stdout}\n${hostKeyFailure.stderr}`,
      /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification/i,
    );

    console.log('relay SSH E2E test OK');
    console.log('strict host-key negative test OK');
  } finally {
    if (bridge) {
      await bridge.close().catch(() => {});
    }
    if (relay) {
      await relay.close().catch(() => {});
    }
    cleanupContainer(containerId);
    spawnSync('docker', ['rmi', imageTag], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
