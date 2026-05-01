import assert from 'node:assert/strict';
import {
  ALLOWED_PAYLOAD_IDS,
  WORKLOAD_MESSAGE_TYPES,
  WorkloadProtocolError,
  validatePayloadId,
  validatePromptMessage,
  validateResponseDelta,
  validateResponseDone,
  validateStopMessage,
  validateWorkloadError,
  validateWorkloadHello,
} from '../../server/workloads/workload_protocol.js';

function assertProtocolError(fn, code) {
  assert.throws(fn, (error) => {
    assert(error instanceof WorkloadProtocolError);
    assert.equal(error.code, code);
    return true;
  });
}

const sessionId = 'sess_workload_proto_123';
const hpc = 'vegahpc';
const promptId = 'prompt_abc123';

for (const payloadId of [
  'gpu_diagnostics_v1',
  'cpu_memory_diagnostics_v1',
  'gams_chat_v1',
]) {
  assert.equal(validatePayloadId(payloadId), payloadId);
}
assert.deepEqual(ALLOWED_PAYLOAD_IDS, [
  'gpu_diagnostics_v1',
  'cpu_memory_diagnostics_v1',
  'gams_chat_v1',
]);
assertProtocolError(() => validatePayloadId('rm -rf /'), 'invalid_payload_id');
assertProtocolError(() => validatePayloadId('unknown_payload'), 'invalid_payload_id');

const hello = {
  type: WORKLOAD_MESSAGE_TYPES.HELLO,
  version: 1,
  sessionId,
  hpc,
  payloadId: 'gams_chat_v1',
  jobId: '12345',
  runtime: 'vllm',
  model: 'cjvt/GaMS3-12B-Instruct',
};
assert.equal(validateWorkloadHello(hello, {
  sessionId,
  hpc,
  payloadId: 'gams_chat_v1',
  jobId: '12345',
}).model, 'cjvt/GaMS3-12B-Instruct');

for (const [patch, code] of [
  [{type: 'wrong'}, 'wrong_type'],
  [{version: 2}, 'wrong_version'],
  [{sessionId: 'bad'}, 'invalid_session_id'],
  [{hpc: 'bad hpc'}, 'invalid_hpc'],
  [{payloadId: 'unknown'}, 'invalid_payload_id'],
  [{jobId: 'abc'}, 'invalid_job_id'],
  [{runtime: 'shell'}, 'invalid_runtime'],
  [{model: 'unknown-model'}, 'invalid_model'],
  [{command: 'whoami'}, 'forbidden_workload_field'],
  [{sshCommand: 'ssh worker'}, 'forbidden_workload_field'],
  [{privateKey: 'secret'}, 'forbidden_workload_field'],
  [{workloadToken: 'slaif_tok_secret'}, 'forbidden_workload_field'],
  [{relayToken: 'slaif_tok_secret'}, 'forbidden_workload_field'],
  [{password: 'secret'}, 'forbidden_workload_field'],
]) {
  assertProtocolError(() => validateWorkloadHello({...hello, ...patch}), code);
}

const prompt = {
  type: WORKLOAD_MESSAGE_TYPES.PROMPT,
  version: 1,
  sessionId,
  promptId,
  messages: [
    {role: 'user', content: 'Pozdravljen.'},
  ],
  options: {
    maxTokens: 1024,
    temperature: 0.6,
    topP: 0.9,
  },
};
assert.equal(validatePromptMessage(prompt).messages[0].role, 'user');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  messages: Array.from({length: 17}, () => ({role: 'user', content: 'x'})),
}), 'invalid_messages');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  messages: [{role: 'user', content: 'x'.repeat(20)}],
}, {maxPromptBytes: 8}), 'content_too_large');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  messages: [{role: 'tool', content: 'x'}],
}), 'invalid_role');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  options: {...prompt.options, maxTokens: 999999},
}), 'invalid_max_tokens');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  options: {...prompt.options, temperature: 3},
}), 'invalid_temperature');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  options: {...prompt.options, topP: 1.5},
}), 'invalid_top_p');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  token: 'slaif_tok_secret',
}), 'forbidden_workload_field');
assertProtocolError(() => validatePromptMessage({
  ...prompt,
  messages: [{role: 'user', content: 'x', command: 'whoami'}],
}), 'forbidden_workload_field');

const delta = {
  type: WORKLOAD_MESSAGE_TYPES.RESPONSE_DELTA,
  version: 1,
  sessionId,
  promptId,
  text: 'delni odgovor',
};
assert.equal(validateResponseDelta(delta, {sessionId, promptId}).text, 'delni odgovor');
assertProtocolError(() => validateResponseDelta({
  ...delta,
  text: 'x'.repeat(32),
}, {}, {maxResponseDeltaBytes: 8}), 'text_too_large');
assertProtocolError(() => validateResponseDelta(delta, {promptId: 'prompt_other'}), 'wrong_promptId');
assertProtocolError(() => validateResponseDelta({
  ...delta,
  jobReportToken: 'slaif_tok_secret',
}), 'forbidden_workload_field');

const done = {
  type: WORKLOAD_MESSAGE_TYPES.RESPONSE_DONE,
  version: 1,
  sessionId,
  promptId,
  finishReason: 'stop',
  usage: {
    inputTokens: 10,
    outputTokens: 20,
  },
};
assert.equal(validateResponseDone(done, {sessionId, promptId}).finishReason, 'stop');
assertProtocolError(() => validateResponseDone({
  ...done,
  finishReason: 'made_up',
}), 'invalid_finish_reason');
assertProtocolError(() => validateResponseDone({
  ...done,
  usage: {inputTokens: -1},
}), 'invalid_usage');
assertProtocolError(() => validateResponseDone({
  ...done,
  usage: {outputTokens: 999999},
}, {}, {maxUsageTokens: 10}), 'invalid_usage');
assertProtocolError(() => validateResponseDone({
  ...done,
  workloadToken: 'slaif_tok_secret',
}), 'forbidden_workload_field');

const stop = {
  type: WORKLOAD_MESSAGE_TYPES.STOP,
  version: 1,
  sessionId,
  reason: 'user_cancelled',
};
assert.equal(validateStopMessage(stop, {sessionId}).reason, 'user_cancelled');
assertProtocolError(() => validateStopMessage({
  ...stop,
  reason: 'because',
}), 'invalid_stop_reason');
assertProtocolError(() => validateStopMessage(stop, {
  sessionId: 'sess_other_session_123',
}), 'wrong_sessionId');

const workloadError = {
  type: WORKLOAD_MESSAGE_TYPES.ERROR,
  version: 1,
  sessionId,
  code: 'invalid_prompt',
  message: 'Safe user-facing message',
};
assert.equal(validateWorkloadError(workloadError, {sessionId}).code, 'invalid_prompt');
assertProtocolError(() => validateWorkloadError({
  ...workloadError,
  message: 'TypeError: leaked stack\n    at secret.js:1:1',
}), 'unsafe_error_message');
assertProtocolError(() => validateWorkloadError({
  ...workloadError,
  privateKey: 'secret',
}), 'forbidden_workload_field');

console.log('workload protocol tests OK');
