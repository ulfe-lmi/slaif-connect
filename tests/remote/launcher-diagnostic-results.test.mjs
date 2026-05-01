import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  parsePayloadResultFromOutput,
} from '../../server/workloads/diagnostic_result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const launcher = path.join(root, 'remote/launcher/slaif-launch');

function intent(payloadId) {
  return {
    type: 'slaif.sessionIntent',
    version: 1,
    sessionId: 'sess_diaglauncher123',
    hpc: 'test-sshd',
    payloadId,
    createdAt: '2026-05-01T12:00:00.000Z',
    expiresAt: '2099-05-01T12:15:00.000Z',
    launcher: {mode: 'normal'},
  };
}

function profiles() {
  return {
    type: 'slaif.slurmProfileCatalog',
    version: 1,
    profiles: {
      cpu_memory_diagnostics_v1: {
        profileId: 'cpu_memory_diagnostics_v1_local',
        payloadId: 'cpu_memory_diagnostics_v1',
        scheduler: 'slurm',
        jobName: 'slaif-cpu-diag',
        timeLimit: '00:05:00',
        cpusPerTask: 1,
        memory: '1G',
        partition: '',
        account: '',
        qos: '',
        maxOutputBytes: 65536,
        template: 'cpu_memory_diagnostics_v1',
      },
      gpu_diagnostics_v1: {
        profileId: 'gpu_diagnostics_v1_local',
        payloadId: 'gpu_diagnostics_v1',
        scheduler: 'slurm',
        jobName: 'slaif-gpu-diag',
        timeLimit: '00:05:00',
        cpusPerTask: 1,
        memory: '1G',
        partition: '',
        account: '',
        qos: '',
        gres: 'gpu:1',
        gpus: 1,
        maxOutputBytes: 65536,
        template: 'gpu_diagnostics_v1',
      },
    },
  };
}

function writeFakeSbatch(fakeBin, {skipOutput = false, oversizeOutput = false, fakeNoGpu = false} = {}) {
  fs.mkdirSync(fakeBin, {recursive: true});
  const fakeSbatch = path.join(fakeBin, 'sbatch');
  fs.writeFileSync(fakeSbatch, [
    '#!/bin/sh',
    'set -eu',
    'out=""',
    'script=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --output) out="$2"; shift 2 ;;',
    '    --*) shift 2 || true ;;',
    '    *) script="$1"; shift ;;',
    '  esac',
    'done',
    '[ -n "$script" ] || exit 66',
    skipOutput ? ':' : (oversizeOutput ?
      'perl -e \'print "x" x 70000\' > "$out"' :
      'SLAIF_SLURM_JOB_ID=424242 SLURM_JOB_ID=424242 /bin/sh "$script" > "$out"'),
    'printf "Submitted batch job 424242\\n"',
    '',
  ].join('\n'));
  fs.chmodSync(fakeSbatch, 0o755);
  if (fakeNoGpu) {
    const fakeNvidiaSmi = path.join(fakeBin, 'nvidia-smi');
    fs.writeFileSync(fakeNvidiaSmi, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeNvidiaSmi, 0o755);
  }
}

function runLauncher(tempDir, payloadId, extraEnv = {}, args = []) {
  const intentPath = path.join(tempDir, `${payloadId}.intent.json`);
  const profilePath = path.join(tempDir, 'profiles.json');
  fs.writeFileSync(intentPath, `${JSON.stringify(intent(payloadId), null, 2)}\n`);
  fs.writeFileSync(profilePath, `${JSON.stringify(profiles(), null, 2)}\n`);
  return spawnSync(launcher, [
    '--session', 'sess_diaglauncher123',
    '--intent-file', intentPath,
    '--profile-file', profilePath,
    '--work-dir', path.join(tempDir, `work-${payloadId}`),
    '--wait-result',
    '--result-timeout-seconds', '2',
    ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempDir,
      PATH: `${path.join(tempDir, 'bin')}:${process.env.PATH}`,
      ...extraEnv,
    },
  });
}

for (const payloadId of ['cpu_memory_diagnostics_v1', 'gpu_diagnostics_v1']) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `slaif-${payloadId}-`));
  try {
    writeFakeSbatch(path.join(tempDir, 'bin'), {fakeNoGpu: payloadId === 'gpu_diagnostics_v1'});
    const result = runLauncher(tempDir, payloadId);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Submitted batch job 424242/);
    assert.match(result.stdout, /SLAIF_PAYLOAD_RESULT_BEGIN/);
    const parsed = parsePayloadResultFromOutput(result.stdout);
    assert.equal(parsed.result.payloadId, payloadId);
    assert.equal(parsed.result.jobId, '424242');
    assert.equal(parsed.result.scheduler, 'slurm');
    if (payloadId === 'gpu_diagnostics_v1') {
      assert.equal(parsed.result.status, 'no_gpu_detected');
      assert.equal(parsed.result.result.gpuAvailable, false);
    } else {
      assert.equal(parsed.result.status, 'completed');
      assert(parsed.result.result.cpuCount > 0);
    }
    for (const forbidden of ['token', 'password', 'privateKey', 'stdout', 'stderr', 'command']) {
      assert.equal(result.stdout.includes(forbidden), false);
    }
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-missing-output-'));
  try {
    writeFakeSbatch(path.join(tempDir, 'bin'), {skipOutput: true});
    const result = runLauncher(tempDir, 'cpu_memory_diagnostics_v1');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing_result_output|result_timeout/);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-oversize-output-'));
  try {
    writeFakeSbatch(path.join(tempDir, 'bin'), {oversizeOutput: true});
    const result = runLauncher(tempDir, 'cpu_memory_diagnostics_v1', {}, ['--max-output-bytes', '4096']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /oversized_result_output/);
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

for (const flag of ['--command', '--shell', '--script', '--job-command']) {
  const result = spawnSync(launcher, [flag, 'whoami', '--session', 'sess_diaglauncher123'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /unknown flag/);
}

console.log('launcher diagnostic result tests OK');
