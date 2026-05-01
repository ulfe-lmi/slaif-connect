import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  SessionIntentError,
  validateSessionIntent,
} from '../../server/workloads/session_intent.js';
import {
  SlurmProfileError,
  buildSbatchArgs,
  buildSbatchScriptFromTemplate,
  resolveSlurmProfile,
  validateSlurmProfile,
  validateSlurmProfileCatalog,
} from '../../server/workloads/slurm_profile.js';
import {parseSchedulerJobSubmission} from '../../extension/js/job_output_parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const launcher = path.join(root, 'remote/launcher/slaif-launch');
const examplesDir = path.join(root, 'remote/launcher/examples');
const devStackSource = fs.readFileSync(path.join(root, 'tools/start-extension-dev-stack.mjs'), 'utf8');
const testSshdDockerfile = fs.readFileSync(path.join(root, 'tests/relay/sshd/Dockerfile'), 'utf8');

function readExample(name) {
  return JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
}

function futureIntent(overrides = {}) {
  return {
    ...readExample('session-intent.cpu.example.json'),
    sessionId: 'sess_launcherintent123',
    createdAt: '2026-05-01T12:00:00.000Z',
    expiresAt: '2099-05-01T12:15:00.000Z',
    ...overrides,
  };
}

function profileCatalog(overrides = {}) {
  return {
    ...readExample('slurm-profiles.example.json'),
    ...overrides,
  };
}

function assertIntentError(intent, code) {
  assert.throws(() => validateSessionIntent(intent), (error) => {
    assert(error instanceof SessionIntentError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertProfileError(fn, code) {
  assert.throws(fn, (error) => {
    assert(error instanceof SlurmProfileError);
    assert.equal(error.code, code);
    return true;
  });
}

assert.equal(validateSessionIntent(futureIntent()).payloadId, 'cpu_memory_diagnostics_v1');
assert.equal(validateSessionIntent(futureIntent({payloadId: 'gpu_diagnostics_v1'})).payloadId, 'gpu_diagnostics_v1');
assert.equal(validateSessionIntent(futureIntent({payloadId: 'gams_chat_v1'})).payloadId, 'gams_chat_v1');
assertIntentError(futureIntent({payloadId: undefined}), 'invalid_payload_id');
assertIntentError(futureIntent({payloadId: 'unknown_payload_v1'}), 'invalid_payload_id');
assertIntentError(futureIntent({command: 'whoami'}), 'forbidden_session_intent_field');
assertIntentError(futureIntent({launcher: {mode: 'normal', scriptText: 'echo bad'}}), 'forbidden_session_intent_field');
assertIntentError(futureIntent({token: 'secret'}), 'forbidden_session_intent_field');
assertIntentError(futureIntent({sshHost: 'login.example'}), 'forbidden_session_intent_field');
assertIntentError(futureIntent({
  createdAt: '2019-01-01T00:00:00.000Z',
  expiresAt: '2020-01-01T00:00:00.000Z',
}), 'expired_intent');

const catalog = validateSlurmProfileCatalog(profileCatalog());
assert.equal(resolveSlurmProfile(catalog, 'cpu_memory_diagnostics_v1').template, 'cpu_memory_diagnostics_v1');
assert.equal(resolveSlurmProfile(catalog, 'gpu_diagnostics_v1').template, 'gpu_diagnostics_v1');
assert.equal(resolveSlurmProfile(catalog, 'gams_chat_v1').template, 'gams_chat_v1_scaffold');

const cpuProfile = resolveSlurmProfile(catalog, 'cpu_memory_diagnostics_v1');
assert.equal(validateSlurmProfile(cpuProfile).payloadId, 'cpu_memory_diagnostics_v1');
for (const [field, value, code] of [
  ['timeLimit', 'five minutes', 'invalid_time_limit'],
  ['memory', '1 gigabyte', 'invalid_memory'],
  ['partition', 'debug;rm', 'invalid_partition'],
]) {
  assertProfileError(() => validateSlurmProfile({...cpuProfile, [field]: value}), code);
}
for (const field of ['command', 'script', 'jobScript']) {
  assertProfileError(() => validateSlurmProfile({...cpuProfile, [field]: 'echo bad'}), 'forbidden_slurm_profile_field');
}
assertProfileError(
    () => validateSlurmProfile({...cpuProfile, payloadId: 'unknown_payload_v1'}),
    'invalid_payload_id',
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-launcher-intent-test-'));
try {
  const scriptPath = path.join(tempDir, 'job.sh');
  const args = buildSbatchArgs(cpuProfile, scriptPath);
  assert(Array.isArray(args));
  assert.equal(args.at(-1), scriptPath);
  assert.equal(args.includes('--account'), false);
  const gpuArgs = buildSbatchArgs(resolveSlurmProfile(catalog, 'gpu_diagnostics_v1'), scriptPath);
  assert(gpuArgs.includes('--gres'));
  assert(gpuArgs.includes('--gpus'));
  assert.equal(gpuArgs.some((arg) => /;|`|\$\(/.test(arg)), false);

  const rendered = buildSbatchScriptFromTemplate('cpu_memory_diagnostics_v1', {
    sessionId: 'sess_launcherintent123',
    payloadId: 'cpu_memory_diagnostics_v1',
    workDir: tempDir,
  });
  assert.match(rendered, /slaif\.payloadResult/);
  assert.doesNotMatch(rendered, /privateKey|workloadToken|relayToken/);

  const intentPath = path.join(tempDir, 'intent.json');
  const profilePath = path.join(tempDir, 'profiles.json');
  fs.writeFileSync(intentPath, `${JSON.stringify(futureIntent(), null, 2)}\n`);
  fs.writeFileSync(profilePath, `${JSON.stringify(profileCatalog(), null, 2)}\n`);

  const dryRun = spawnSync(launcher, [
    '--session', 'sess_launcherintent123',
    '--intent-file', intentPath,
    '--profile-file', profilePath,
    '--work-dir', path.join(tempDir, 'work'),
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempDir,
    },
  });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const drySummary = JSON.parse(dryRun.stdout);
  assert.equal(drySummary.type, 'slaif.launcherDryRun');
  assert.equal(drySummary.payloadId, 'cpu_memory_diagnostics_v1');
  assert.equal(dryRun.stdout.includes('secret'), false);
  assert.equal(dryRun.stdout.includes('token'), false);

  const fakeBin = path.join(tempDir, 'bin');
  const fakeSbatch = path.join(fakeBin, 'sbatch');
  const logPath = path.join(tempDir, 'sbatch-args.json');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(fakeSbatch, `#!/bin/sh
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${JSON.stringify(logPath)} "$@"
printf 'Submitted batch job 424242\\n'
`);
  fs.chmodSync(fakeSbatch, 0o755);
  const submit = spawnSync(launcher, [
    '--session', 'sess_launcherintent123',
    '--intent-file', intentPath,
    '--profile-file', profilePath,
    '--work-dir', path.join(tempDir, 'work-submit'),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempDir,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  });
  assert.equal(submit.status, 0, submit.stderr);
  assert.equal(submit.stdout, 'Submitted batch job 424242\n');
  assert.deepEqual(parseSchedulerJobSubmission(submit.stdout), {
    ok: true,
    scheduler: 'slurm',
    jobId: '424242',
  });
  const sbatchArgs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  assert(sbatchArgs.includes('--job-name'));
  assert.match(sbatchArgs.at(-1), /cpu_memory_diagnostics_v1\.sbatch\.sh$/);
  const generatedScript = fs.readFileSync(sbatchArgs.at(-1), 'utf8');
  assert.match(generatedScript, /slaif\.payloadResult/);
  assert.doesNotMatch(generatedScript, /echo bad|privateKey|workloadToken/);
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true});
}

for (const flag of ['--command', '--shell', '--script', '--job-command', '--definitely-unknown']) {
  const result = spawnSync(launcher, [flag, 'anything', '--session', 'sess_launcherintent123'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /unknown flag/);
}

assert.match(devStackSource, /--intent-file \/keys\/session-intent\.json/);
assert.match(devStackSource, /--profile-file \/keys\/slurm-profiles\.json/);
assert.match(devStackSource, /PATH=\/keys:\$PATH \/keys\/slaif-launch/);
assert.match(devStackSource, /--wait-result/);
assert.doesNotMatch(devStackSource, /SLAIF_LAUNCHER_TEST_JOB_ID=\$\{expectedJobId\}/);
assert.match(testSshdDockerfile, /\bpython3\b/);

console.log('launcher payload intent tests OK');
