import assert from 'node:assert/strict';
import {
  buildPayloadResultEndpoint,
  buildPayloadResultReportPayload,
  postPayloadResult,
} from '../../extension/js/slaif_payload_result_reporter.js';

const policy = {
  type: 'slaif.hpcPolicy',
  allowedApiOrigins: ['https://connect.slaif.test'],
};

const payloadResult = {
  type: 'slaif.payloadResult',
  version: 1,
  sessionId: 'sess_payloadreport123',
  hpc: 'vegahpc',
  payloadId: 'cpu_memory_diagnostics_v1',
  scheduler: 'slurm',
  jobId: '424242',
  status: 'completed',
  result: {
    node: 'test-node',
    cpuCount: 2,
    memoryTotalMiB: 4096,
  },
};

const endpoint = buildPayloadResultEndpoint('https://connect.slaif.test/', 'sess_payloadreport123', policy);
assert.equal(endpoint, 'https://connect.slaif.test/api/connect/session/sess_payloadreport123/payload-result');
const report = buildPayloadResultReportPayload({
  sessionId: 'sess_payloadreport123',
  hpc: 'vegahpc',
  payloadResult,
  reportedAt: '2026-05-01T12:00:00.000Z',
});
assert.equal(report.type, 'slaif.payloadResult');
assert.equal(report.reportedAt, '2026-05-01T12:00:00.000Z');
for (const forbidden of ['stdout', 'stderr', 'transcript', 'password', 'token', 'command', 'scriptText']) {
  assert.equal(Object.hasOwn(report, forbidden), false);
}
assert.throws(
    () => buildPayloadResultEndpoint('https://evil.example/', 'sess_payloadreport123', policy),
    /API base URL is not allowed|not allowed/,
);
assert.throws(
    () => buildPayloadResultReportPayload({
      sessionId: 'bad',
      hpc: 'vegahpc',
      payloadResult,
    }),
    /invalid SLAIF session id/,
);
assert.throws(
    () => buildPayloadResultReportPayload({
      sessionId: 'sess_payloadreport123',
      hpc: 'vegahpc',
      payloadResult: {...payloadResult, payloadId: 'gams_chat_v1'},
    }),
    /invalid payloadId/,
);

const seen = [];
const sent = await postPayloadResult({
  apiBaseUrl: 'https://connect.slaif.test/',
  sessionId: 'sess_payloadreport123',
  hpc: 'vegahpc',
  jobReportToken: 'tok_payload_result_1234567890',
  jobReportTokenExpiresAt: '2099-01-01T00:00:00.000Z',
  policy,
  payloadResult,
  fetchImpl: async (url, options) => {
    seen.push({url, options});
    return {ok: true, status: 200};
  },
});
assert.equal(sent.jobId, '424242');
assert.equal(seen[0].url.includes('tok_payload_result_1234567890'), false);
assert.equal(seen[0].options.headers.Authorization, 'Bearer tok_payload_result_1234567890');
assert.equal(JSON.parse(seen[0].options.body).stdout, undefined);

await assert.rejects(
    () => postPayloadResult({
      apiBaseUrl: 'https://connect.slaif.test/',
      sessionId: 'sess_payloadreport123',
      hpc: 'vegahpc',
      jobReportToken: 'tok_payload_result_secret_1234567890',
      jobReportTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      policy,
      payloadResult,
      fetchImpl: async () => ({ok: false, status: 403}),
    }),
    (error) => {
      assert.match(error.message, /payload result rejected/);
      assert.equal(error.message.includes('tok_payload_result_secret_1234567890'), false);
      return true;
    },
);

console.log('payload result reporter tests OK');
