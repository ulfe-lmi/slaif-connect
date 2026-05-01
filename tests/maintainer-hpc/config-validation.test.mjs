import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  MaintainerConfigError,
  loadMaintainerConfig,
  validateMaintainerConfig,
} from '../../maintainer/hpc-test-kit/local/validate-maintainer-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function loadExample(name) {
  return JSON.parse(fs.readFileSync(
      path.join(root, 'maintainer/hpc-test-kit/configs', `${name}.example.json`),
      'utf8',
  ));
}

function validRealConfig(overrides = {}) {
  return {
    ...loadExample('vega'),
    selectedLoginHost: 'login.vega.izum.si',
    username: 'maintainer',
    verifiedKnownHostsFile: '/home/maintainer/.slaif-connect/vega.verified-known-hosts',
    remoteBaseDir: '~/.slaif-connect/hpc-tests',
    ...overrides,
  };
}

for (const system of ['vega', 'arnes', 'nsc']) {
  const configPath = path.join(root, 'maintainer/hpc-test-kit/configs', `${system}.example.json`);
  const loaded = loadMaintainerConfig(configPath, {exampleMode: true});
  assert.equal(loaded.system, system);
}

function assertConfigError(config, code, options = {}) {
  assert.throws(() => validateMaintainerConfig(config, options), (error) => {
    assert(error instanceof MaintainerConfigError);
    assert.equal(error.code, code);
    return true;
  });
}

assertConfigError({
  ...validRealConfig(),
  verifiedKnownHostsFile: '',
}, 'missing_verified_known_hosts');

for (const remoteBaseDir of ['/', '/tmp', '/etc/slaif', '/usr/local/slaif', '/opt/slaif']) {
  assertConfigError({
    ...validRealConfig(),
    remoteBaseDir,
  }, 'unsafe_remote_base_dir');
}

for (const field of ['password', 'otp', 'privateKey', 'workloadToken']) {
  assertConfigError({
    ...validRealConfig(),
    [field]: 'secret',
  }, 'forbidden_secret_field');
}

assertConfigError({
  ...validRealConfig(),
  selectedLoginHost: 'other.example.org',
}, 'selected_host_not_allowed');

assertConfigError({
  ...validRealConfig(),
  yolo: {
    command: 'echo should-not-run',
    allowYolo: false,
    iUnderstandThisRunsArbitraryCode: false,
  },
}, 'yolo_command_without_gate');

assertConfigError({
  ...validRealConfig(),
  tests: {
    ...validRealConfig().tests,
    runYolo: true,
  },
  yolo: {
    command: '',
    allowYolo: true,
    iUnderstandThisRunsArbitraryCode: true,
  },
}, 'yolo_command_missing');

validateMaintainerConfig({
  ...validRealConfig(),
  tests: {
    ...validRealConfig().tests,
    runYolo: true,
  },
  yolo: {
    command: 'echo yolo-ok',
    allowYolo: true,
    iUnderstandThisRunsArbitraryCode: true,
  },
});

console.log('maintainer HPC config validation tests OK');
