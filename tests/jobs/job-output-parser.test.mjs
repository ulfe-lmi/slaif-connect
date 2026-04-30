import assert from 'node:assert/strict';
import {
  boundSchedulerOutput,
  parseSchedulerJobSubmission,
  parseSlurmJobId,
  parseSlurmJobSubmission,
} from '../../extension/js/job_output_parser.js';

assert.deepEqual(parseSlurmJobSubmission('Submitted batch job 12345'), {
  ok: true,
  scheduler: 'slurm',
  jobId: '12345',
});
assert.deepEqual(parseSlurmJobSubmission('sbatch: Submitted batch job 987654\n'), {
  ok: true,
  scheduler: 'slurm',
  jobId: '987654',
});
assert.equal(parseSlurmJobId('queued\nSubmitted batch job 987654\n'), '987654');
assert.equal(parseSlurmJobId('Submitted interactive session abc'), null);
assert.equal(parseSlurmJobId(null), null);
assert.equal(parseSlurmJobSubmission('queued 12345').reason, 'no_job_id');
assert.equal(parseSlurmJobSubmission('').reason, 'empty_output');
assert.equal(
    parseSlurmJobSubmission('Submitted batch job 12345\nSubmitted batch job 67890').reason,
    'ambiguous_job_id',
);
assert.equal(
    parseSlurmJobSubmission('Submitted batch job 12345\nSubmitted batch job 12345').jobId,
    '12345',
);
assert.equal(parseSchedulerJobSubmission('Submitted batch job 1', {scheduler: 'pbs'}).reason,
    'unsupported_scheduler');
assert.equal(boundSchedulerOutput(`prefix\nSubmitted batch job 12345`, 25), 'Submitted batch job 12345');

console.log('job output parser tests OK');
