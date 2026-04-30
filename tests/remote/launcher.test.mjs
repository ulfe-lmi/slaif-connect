import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseSchedulerJobSubmission} from '../../extension/js/job_output_parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const launcher = path.join(root, 'remote/launcher/slaif-launch');

function run(args, options = {}) {
  return spawnSync(launcher, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function assertFails(args, pattern, options = {}) {
  const result = run(args, options);
  assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly succeeded`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

assert.equal(run(['--help']).status, 0);
assert.match(run(['--help']).stdout, /Usage: slaif-launch/);
assert.equal(run(['--version']).status, 0);
assert.match(run(['--version']).stdout, /slaif-launch reference/);

const testResult = run(['--session', 'sess_launcher123'], {
  env: {
    SLAIF_LAUNCHER_TEST_JOB_ID: '424242',
    SLAIF_SECRET_SHOULD_NOT_PRINT: 'do-not-print-me',
  },
});
assert.equal(testResult.status, 0, testResult.stderr);
assert.equal(testResult.stdout, 'Submitted batch job 424242\n');
assert.equal(testResult.stdout.includes('do-not-print-me'), false);
assert.deepEqual(parseSchedulerJobSubmission(testResult.stdout), {
  ok: true,
  scheduler: 'slurm',
  jobId: '424242',
});

const dryRun = run(['--dry-run', '--session', 'sess_launcher123']);
assert.equal(dryRun.status, 0, dryRun.stderr);
assert.equal(dryRun.stdout, 'Submitted batch job 424242\n');

assertFails([], /--session is required/);
assertFails(['--session'], /missing value/);
assertFails(['--scheduler', 'pbs', '--session', 'sess_launcher123'], /unsupported scheduler/);

for (const badSession of [
  'sess_short',
  'sess_abc;rm-rfxx',
  'sess_abc$(id)xx',
  'sess_abc`id`xxx',
  'sess_abc with spaces',
  '../sess_abc123456',
  '"sess_abc123456"',
]) {
  assertFails(['--session', badSession], /invalid SLAIF session id/);
}

for (const badFlag of [
  '--command',
  '--job-command',
  '--script',
  '--shell',
]) {
  assertFails([badFlag, 'anything', '--session', 'sess_launcher123'], /unknown flag/);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-launcher-test-'));
try {
  const fakeBin = path.join(tempDir, 'bin');
  const logPath = path.join(tempDir, 'sbatch.log');
  const scriptPath = path.join(tempDir, 'approved-job.sh');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(scriptPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(scriptPath, 0o755);
  const fakeSbatch = path.join(fakeBin, 'sbatch');
  fs.writeFileSync(fakeSbatch, `#!/bin/sh
printf '%s\\n' "$#" >${JSON.stringify(logPath)}
printf '%s\\n' "$1" >>${JSON.stringify(logPath)}
printf '%s\\n' "$SLAIF_SESSION_ID" >>${JSON.stringify(logPath)}
printf 'Submitted batch job 515151\\n'
`);
  fs.chmodSync(fakeSbatch, 0o755);

  const realMode = run(['--session', 'sess_launcher456'], {
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      SLAIF_SLURM_SCRIPT: scriptPath,
    },
  });
  assert.equal(realMode.status, 0, realMode.stderr);
  assert.equal(realMode.stdout, 'Submitted batch job 515151\n');
  assert.equal(fs.readFileSync(logPath, 'utf8'), `1\n${scriptPath}\nsess_launcher456\n`);

  assertFails(['--session', 'sess_launcher456'], /absolute safe site-owned path/, {
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      SLAIF_SLURM_SCRIPT: 'relative-job.sh',
    },
  });
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true});
}

console.log('remote launcher tests OK');
