import assert from 'node:assert/strict';
import {parseSlurmJobId} from '../extension/js/job_output_parser.js';

assert.equal(parseSlurmJobId('Submitted batch job 12345'), '12345');
assert.equal(parseSlurmJobId('queued\nSubmitted batch job 987654\n'), '987654');
assert.equal(parseSlurmJobId('Submitted interactive session abc'), null);
assert.equal(parseSlurmJobId(null), null);

console.log('job output parser tests OK');
