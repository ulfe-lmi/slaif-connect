import assert from 'node:assert/strict';
import {
  buildJobReportEndpoint,
  buildJobReportPayload,
  postJobReport,
} from '../../extension/js/slaif_job_reporter.js';

const sessionId = 'sess_jobs123456';
const hpc = 'test-sshd';
const policy = {
  type: 'slaif.hpcPolicy',
  allowedApiOrigins: ['https://connect.slaif.si', 'http://127.0.0.1:18080'],
};

const successPayload = buildJobReportPayload({
  sessionId,
  hpc,
  scheduler: 'slurm',
  jobId: '424242',
  status: 'submitted',
  sshExitCode: 0,
  reportedAt: '2026-04-30T12:00:00.000Z',
});
assert.deepEqual(successPayload, {
  type: 'slaif.jobReport',
  version: 1,
  sessionId,
  hpc,
  scheduler: 'slurm',
  jobId: '424242',
  status: 'submitted',
  sshExitCode: 0,
  reportedAt: '2026-04-30T12:00:00.000Z',
});

const failurePayload = buildJobReportPayload({
  sessionId,
  hpc,
  status: 'job_id_not_found',
  sshExitCode: 0,
});
assert.equal(failurePayload.status, 'job_id_not_found');
assert.equal(Object.hasOwn(failurePayload, 'jobId'), false);
assert.equal(Object.hasOwn(failurePayload, 'stdout'), false);
assert.equal(Object.hasOwn(failurePayload, 'stderr'), false);

assert.throws(() => buildJobReportPayload({
  sessionId,
  hpc,
  scheduler: 'slurm',
  jobId: 'abc',
  status: 'submitted',
}), /SLURM job ID/);
assert.throws(() => buildJobReportPayload({
  sessionId,
  hpc,
  scheduler: 'pbs',
  jobId: '123',
  status: 'submitted',
}), /scheduler/);
assert.throws(() => buildJobReportPayload({sessionId: 'bad', hpc, status: 'job_id_not_found'}),
    /session id/);
assert.throws(() => buildJobReportPayload({sessionId, hpc: 'bad host', status: 'job_id_not_found'}),
    /alias/);

const endpoint = buildJobReportEndpoint('https://connect.slaif.si/', sessionId, policy);
assert.equal(endpoint, 'https://connect.slaif.si/api/connect/session/sess_jobs123456/job-report');
assert.throws(() => buildJobReportEndpoint('https://attacker.example/', sessionId, policy),
    /not allowed/);

let observedRequest;
await postJobReport({
  apiBaseUrl: 'https://connect.slaif.si/',
  sessionId,
  hpc,
  jobReportToken: 'job-report-token-123456',
  jobReportTokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
  policy,
  report: {
    scheduler: 'slurm',
    jobId: '424242',
    status: 'submitted',
    sshExitCode: 0,
  },
  fetchImpl: async (url, options) => {
    observedRequest = {url, options};
    return {ok: true, status: 200};
  },
});
assert.equal(observedRequest.url.includes('job-report-token'), false);
assert.equal(observedRequest.options.headers.Authorization, 'Bearer job-report-token-123456');
const observedPayload = JSON.parse(observedRequest.options.body);
for (const forbidden of [
  'stdout',
  'stderr',
  'transcript',
  'password',
  'otp',
  'privateKey',
  'relayToken',
  'launchToken',
  'jobReportToken',
]) {
  assert.equal(Object.hasOwn(observedPayload, forbidden), false);
}

assert.rejects(() => postJobReport({
  apiBaseUrl: 'https://connect.slaif.si/',
  sessionId,
  hpc,
  jobReportToken: 'job-report-token-123456',
  jobReportTokenExpiresAt: new Date(Date.now() - 60000).toISOString(),
  policy,
  report: {status: 'job_id_not_found', sshExitCode: 0},
  fetchImpl: async () => ({ok: true, status: 200}),
}), /expired/);

console.log('job reporter tests OK');
