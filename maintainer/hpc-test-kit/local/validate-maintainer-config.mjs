import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export class MaintainerConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MaintainerConfigError';
    this.code = code;
  }
}

const ALLOWED_SYSTEMS = new Set(['vega', 'arnes', 'nsc', 'custom']);
const FORBIDDEN_FIELD_NAMES = new Set([
  'password',
  'passwd',
  'otp',
  'totp',
  'privateKey',
  'sshPrivateKey',
  'passphrase',
  'launchToken',
  'relayToken',
  'jobReportToken',
  'workloadToken',
  'token',
  'authorization',
  'Authorization',
]);
const SAFE_SLURM_VALUE = /^[A-Za-z0-9_@%+=:.,/ -]*$/;
const ALLOWED_LAUNCHER_INTENT_PAYLOAD_IDS = new Set([
  'cpu_memory_diagnostics_v1',
  'gpu_diagnostics_v1',
  'gams_chat_v1',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholder(value) {
  return typeof value === 'string' && /^REPLACE_ME/.test(value);
}

function assert(condition, code, message) {
  if (!condition) {
    throw new MaintainerConfigError(code, message);
  }
}

function walkForbiddenFields(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForbiddenFields(item, [...pathParts, String(index)]));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      throw new MaintainerConfigError(
          'forbidden_secret_field',
          `maintainer config must not contain forbidden field ${[...pathParts, key].join('.')}`,
      );
    }
    walkForbiddenFields(nested, [...pathParts, key]);
  }
}

export function isSafeRemoteBaseDir(remoteBaseDir) {
  if (typeof remoteBaseDir !== 'string' || remoteBaseDir.trim() === '') {
    return false;
  }
  const value = remoteBaseDir.trim();
  if (value === '~' || value.startsWith('~/')) {
    return value !== '~/';
  }
  if (value === '/' || value === '/tmp') {
    return false;
  }
  if (/^\/(etc|usr|opt|bin|sbin|var)(\/|$)/.test(value)) {
    return false;
  }
  if (/^\/tmp\/?[^/]*$/.test(value)) {
    return false;
  }
  return /^\/home\/[^/]+\/\.slaif-connect\/hpc-tests(\/.*)?$/.test(value) ||
      /^\/tmp\/[^/]+\/\.slaif-connect\/hpc-tests(\/.*)?$/.test(value);
}

function validateSlurm(slurm = {}) {
  assert(isPlainObject(slurm), 'invalid_slurm', 'slurm must be an object');
  for (const [key, value] of Object.entries(slurm)) {
    if (typeof value === 'string') {
      assert(SAFE_SLURM_VALUE.test(value), 'unsafe_slurm_value', `unsafe Slurm value for ${key}`);
    }
  }
  for (const key of ['cpusPerTask', 'gpus']) {
    if (slurm[key] !== undefined && slurm[key] !== '') {
      assert(Number.isInteger(slurm[key]) && slurm[key] >= 0 && slurm[key] <= 128,
          'invalid_slurm_number', `${key} must be a bounded non-negative integer`);
    }
  }
}

function validateYolo(config, options) {
  const tests = config.tests || {};
  const yolo = config.yolo || {};
  assert(isPlainObject(tests), 'invalid_tests', 'tests must be an object');
  assert(isPlainObject(yolo), 'invalid_yolo', 'yolo must be an object');

  if (!tests.runYolo && yolo.command) {
    throw new MaintainerConfigError('yolo_command_without_gate', 'yolo.command is allowed only when tests.runYolo is true');
  }

  if (tests.runYolo || options.phase === 'yolo' || options.phase === 'all-with-yolo') {
    assert(yolo.allowYolo === true, 'yolo_not_allowed', 'YOLO requires yolo.allowYolo=true');
    assert(yolo.iUnderstandThisRunsArbitraryCode === true,
        'yolo_ack_missing', 'YOLO requires iUnderstandThisRunsArbitraryCode=true');
    assert(typeof yolo.command === 'string' && yolo.command.trim() !== '',
        'yolo_command_missing', 'YOLO requires a non-empty yolo.command');
  }
}

function validateLauncherIntent(config) {
  const tests = config.tests || {};
  assert(isPlainObject(tests), 'invalid_tests', 'tests must be an object');
  if (tests.launcherIntentPayloadId !== undefined) {
    assert(ALLOWED_LAUNCHER_INTENT_PAYLOAD_IDS.has(tests.launcherIntentPayloadId),
        'invalid_launcher_intent_payload',
        'tests.launcherIntentPayloadId must be one of the normal MVP payload IDs');
  }
  if (tests.runLauncherIntentSubmit === true) {
    assert(tests.runLauncherIntentDryRun === true,
        'launcher_intent_submit_without_dry_run',
        'launcher intent submit must be paired with dry-run config');
  }
}

export function validateMaintainerConfig(config, options = {}) {
  const mergedOptions = {
    exampleMode: false,
    allowCustomHost: false,
    requireVerifiedKnownHosts: false,
    phase: '',
    ...options,
  };

  assert(isPlainObject(config), 'invalid_config', 'maintainer config must be an object');
  walkForbiddenFields(config);

  assert(config.type === 'slaif.maintainerHpcTestConfig',
      'invalid_type', 'type must be slaif.maintainerHpcTestConfig');
  assert(config.version === 1, 'invalid_version', 'version must be 1');
  assert(ALLOWED_SYSTEMS.has(config.system), 'invalid_system', 'system must be vega, arnes, nsc, or custom');
  assert(Array.isArray(config.loginHostCandidates) && config.loginHostCandidates.length > 0,
      'missing_login_candidates', 'loginHostCandidates must be a non-empty array');
  assert(typeof config.selectedLoginHost === 'string' && config.selectedLoginHost.trim() !== '',
      'missing_selected_login_host', 'selectedLoginHost is required');

  const selectedIsPlaceholder = isPlaceholder(config.selectedLoginHost);
  if (!selectedIsPlaceholder) {
    const inCandidates = config.loginHostCandidates.includes(config.selectedLoginHost);
    assert(inCandidates || (config.system === 'custom' && mergedOptions.allowCustomHost),
        'selected_host_not_allowed', 'selectedLoginHost must be listed in loginHostCandidates');
  } else {
    assert(mergedOptions.exampleMode, 'selected_host_placeholder', 'selectedLoginHost must be replaced for real runs');
  }

  assert(typeof config.username === 'string' && config.username.trim() !== '',
      'missing_username', 'username is required');
  assert(mergedOptions.exampleMode || !isPlaceholder(config.username),
      'username_placeholder', 'username must be replaced for real runs');

  assert(isSafeRemoteBaseDir(config.remoteBaseDir),
      'unsafe_remote_base_dir', 'remoteBaseDir must be under the user home or a user-specific test directory');

  if (mergedOptions.requireVerifiedKnownHosts || !mergedOptions.exampleMode) {
    assert(typeof config.verifiedKnownHostsFile === 'string' &&
        config.verifiedKnownHostsFile.trim() !== '' &&
        !isPlaceholder(config.verifiedKnownHostsFile),
    'missing_verified_known_hosts',
    'verifiedKnownHostsFile is required before real SSH tests');
  }

  validateSlurm(config.slurm || {});
  validateLauncherIntent(config);
  validateYolo(config, mergedOptions);

  return {
    system: config.system,
    selectedLoginHost: config.selectedLoginHost,
    remoteBaseDir: config.remoteBaseDir,
    runYolo: Boolean(config.tests?.runYolo),
  };
}

export function loadMaintainerConfig(configPath, options = {}) {
  const resolved = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  validateMaintainerConfig(config, options);
  return config;
}

function parseCli(argv) {
  const args = {example: false, allowCustomHost: false, requireVerifiedKnownHosts: false};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      args.config = argv[++i];
    } else if (arg === '--example') {
      args.example = true;
    } else if (arg === '--allow-custom-host') {
      args.allowCustomHost = true;
    } else if (arg === '--require-verified-known-hosts') {
      args.requireVerifiedKnownHosts = true;
    } else {
      throw new MaintainerConfigError('unknown_arg', `unknown argument ${arg}`);
    }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseCli(process.argv);
    if (!args.config) {
      throw new MaintainerConfigError('missing_config', '--config is required');
    }
    loadMaintainerConfig(args.config, {
      exampleMode: args.example,
      allowCustomHost: args.allowCustomHost,
      requireVerifiedKnownHosts: args.requireVerifiedKnownHosts,
    });
    console.log('maintainer HPC config OK');
  } catch (error) {
    const code = error instanceof MaintainerConfigError ? error.code : 'invalid_json';
    console.error(`maintainer HPC config invalid: ${code}: ${error.message}`);
    process.exit(1);
  }
}
