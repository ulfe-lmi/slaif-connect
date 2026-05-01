import assert from 'node:assert/strict';
import {
  PAYLOAD_RESULT_BEGIN_MARKER,
  PAYLOAD_RESULT_END_MARKER,
  PayloadResultError,
  parsePayloadResultFromOutput,
  validateCpuMemoryDiagnosticsResult,
  validateGpuDiagnosticsResult,
  validatePayloadResult,
} from '../../server/workloads/diagnostic_result.js';

const base = {
  type: 'slaif.payloadResult',
  version: 1,
  sessionId: 'sess_diagnostic123',
  hpc: 'vegahpc',
  scheduler: 'slurm',
  jobId: '12345',
};

const cpuResult = {
  ...base,
  payloadId: 'cpu_memory_diagnostics_v1',
  status: 'completed',
  result: {
    node: 'cpu-node-01',
    cpuCount: 128,
    memoryTotalMiB: 515000,
    architecture: 'x86_64',
    slurmPartition: 'debug',
  },
};

const gpuResult = {
  ...base,
  payloadId: 'gpu_diagnostics_v1',
  status: 'completed',
  result: {
    node: 'gpu-node-01',
    gpus: [{
      name: 'NVIDIA A100',
      memoryTotalMiB: 40960,
      driverVersion: '535.129',
    }],
    gpuAvailable: true,
  },
};

const noGpuResult = {
  ...base,
  payloadId: 'gpu_diagnostics_v1',
  status: 'no_gpu_detected',
  result: {
    node: 'node-01',
    gpus: [],
    gpuAvailable: false,
    reason: 'nvidia-smi not available',
  },
};

function assertPayloadError(fn, code) {
  assert.throws(fn, (error) => {
    assert(error instanceof PayloadResultError);
    assert.equal(error.code, code);
    return true;
  });
}

assert.equal(validateCpuMemoryDiagnosticsResult(cpuResult.result).cpuCount, 128);
assertPayloadError(
    () => validatePayloadResult({...cpuResult, result: {...cpuResult.result, cpuCount: undefined}}),
    'invalid_cpuCount',
);
assertPayloadError(
    () => validatePayloadResult({...cpuResult, result: {...cpuResult.result, memoryTotalMiB: -1}}),
    'invalid_memoryTotalMiB',
);
for (const field of ['stdout', 'stderr', 'transcript', 'token']) {
  assertPayloadError(
      () => validatePayloadResult({...cpuResult, result: {...cpuResult.result, [field]: 'secret'}}),
      'forbidden_payload_result_field',
  );
}

assert.equal(validateGpuDiagnosticsResult(gpuResult.result).gpus[0].name, 'NVIDIA A100');
assert.equal(validatePayloadResult(noGpuResult).status, 'no_gpu_detected');
assertPayloadError(
    () => validatePayloadResult({
      ...gpuResult,
      result: {node: 'gpu-node-01', gpus: [{name: 'bad', memoryTotalMiB: 0}]},
    }),
    'invalid_gpuMemoryTotalMiB',
);
assertPayloadError(
    () => validatePayloadResult({
      ...gpuResult,
      result: {node: 'gpu-node-01', gpus: [{name: 'bad', driverVersion: '535;rm'}]},
    }),
    'invalid_driverVersion',
);
assertPayloadError(
    () => validatePayloadResult({...gpuResult, workloadToken: 'secret'}),
    'forbidden_payload_result_field',
);

const framed = [
  'scheduler chatter',
  PAYLOAD_RESULT_BEGIN_MARKER,
  JSON.stringify(cpuResult),
  PAYLOAD_RESULT_END_MARKER,
  'ignored trailer',
].join('\n');
assert.equal(parsePayloadResultFromOutput(framed).result.payloadId, 'cpu_memory_diagnostics_v1');
assertPayloadError(() => parsePayloadResultFromOutput(JSON.stringify(cpuResult)), 'missing_begin_marker');
assertPayloadError(
    () => parsePayloadResultFromOutput(`${PAYLOAD_RESULT_BEGIN_MARKER}\n${JSON.stringify(cpuResult)}\n`),
    'missing_end_marker',
);
assertPayloadError(
    () => parsePayloadResultFromOutput(`${PAYLOAD_RESULT_BEGIN_MARKER}\n{bad json}\n${PAYLOAD_RESULT_END_MARKER}`),
    'malformed_json',
);
assertPayloadError(() => parsePayloadResultFromOutput('x'.repeat(2000), {maxOutputBytes: 100}), 'oversized_output');
assertPayloadError(
    () => parsePayloadResultFromOutput(
        `${PAYLOAD_RESULT_BEGIN_MARKER}\n${JSON.stringify(cpuResult)}\n${PAYLOAD_RESULT_END_MARKER}`,
        {maxJsonBytes: 10},
    ),
    'oversized_result_json',
);
assertPayloadError(
    () => parsePayloadResultFromOutput([
      PAYLOAD_RESULT_BEGIN_MARKER,
      JSON.stringify(cpuResult),
      PAYLOAD_RESULT_END_MARKER,
      PAYLOAD_RESULT_BEGIN_MARKER,
      JSON.stringify(gpuResult),
      PAYLOAD_RESULT_END_MARKER,
    ].join('\n')),
    'multiple_result_blocks',
);
assertPayloadError(
    () => parsePayloadResultFromOutput([
      PAYLOAD_RESULT_BEGIN_MARKER,
      JSON.stringify({...cpuResult, result: {...cpuResult.result, rawOutput: 'no'}}),
      PAYLOAD_RESULT_END_MARKER,
    ].join('\n')),
    'forbidden_payload_result_field',
);

console.log('diagnostic result tests OK');
