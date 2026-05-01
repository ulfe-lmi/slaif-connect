export const PAYLOAD_RESULT_BEGIN_MARKER = 'SLAIF_PAYLOAD_RESULT_BEGIN';
export const PAYLOAD_RESULT_END_MARKER = 'SLAIF_PAYLOAD_RESULT_END';

const ALLOWED_PAYLOAD_IDS = new Set([
  'cpu_memory_diagnostics_v1',
  'gpu_diagnostics_v1',
]);

const ALLOWED_STATUSES = new Set([
  'completed',
  'failed',
  'no_gpu_detected',
  'timeout',
  'parse_error',
]);

const FORBIDDEN_FIELDS = new Set([
  'password',
  'passphrase',
  'otp',
  'privateKey',
  'sshPrivateKey',
  'launchToken',
  'relayToken',
  'jobReportToken',
  'workloadToken',
  'token',
  'Authorization',
  'authorization',
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
  'transcript',
  'stdout',
  'stderr',
  'rawOutput',
]);

const SESSION_RE = /^sess_[A-Za-z0-9_-]{8,128}$/;
const HPC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_SCHEDULER_JOB_ID_RE = /^[0-9]{1,32}$/;
const SAFE_TEXT_RE = /^[A-Za-z0-9 _./:@%+=,()[\]-]{0,256}$/;

export class PayloadResultError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PayloadResultError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new PayloadResultError('invalid_object', `${name} must be an object`);
  }
}

function assertSafeBoundedString(value, name, {required = true, max = 128} = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new PayloadResultError(`invalid_${name}`, `${name} is required`);
    }
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max || !SAFE_TEXT_RE.test(value)) {
    throw new PayloadResultError(`invalid_${name}`, `${name} is invalid`);
  }
  return value;
}

function assertPositiveInteger(value, name, {required = true, max = 10_000_000} = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw new PayloadResultError(`invalid_${name}`, `${name} is required`);
    }
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new PayloadResultError(`invalid_${name}`, `${name} is invalid`);
  }
  return value;
}

export function assertNoForbiddenPayloadResultFields(value, path = '') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenPayloadResultFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new PayloadResultError(
          'forbidden_payload_result_field',
          `payload result must not include ${path}${key}`,
      );
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenPayloadResultFields(nested, `${path}${key}.`);
    }
  }
}

export function validateCpuMemoryDiagnosticsResult(result) {
  assertPlainObject(result, 'CPU diagnostic result');
  assertNoForbiddenPayloadResultFields(result);
  assertSafeBoundedString(result.node, 'node');
  assertPositiveInteger(result.cpuCount, 'cpuCount', {max: 1_000_000});
  assertPositiveInteger(result.memoryTotalMiB, 'memoryTotalMiB', {
    required: result.memoryTotalMiB !== undefined,
    max: 100_000_000,
  });
  assertSafeBoundedString(result.architecture, 'architecture', {required: false, max: 64});
  assertSafeBoundedString(result.slurmPartition, 'slurmPartition', {required: false, max: 128});
  return result;
}

export function validateGpuDiagnosticsResult(result) {
  assertPlainObject(result, 'GPU diagnostic result');
  assertNoForbiddenPayloadResultFields(result);
  assertSafeBoundedString(result.node, 'node');
  if (!Array.isArray(result.gpus) || result.gpus.length > 64) {
    throw new PayloadResultError('invalid_gpus', 'gpus must be an array');
  }
  for (const gpu of result.gpus) {
    assertPlainObject(gpu, 'GPU entry');
    assertNoForbiddenPayloadResultFields(gpu);
    assertSafeBoundedString(gpu.name, 'gpuName', {max: 128});
    assertPositiveInteger(gpu.memoryTotalMiB, 'gpuMemoryTotalMiB', {required: false, max: 10_000_000});
    assertSafeBoundedString(gpu.driverVersion, 'driverVersion', {required: false, max: 64});
  }
  if (result.gpuAvailable !== undefined && typeof result.gpuAvailable !== 'boolean') {
    throw new PayloadResultError('invalid_gpuAvailable', 'gpuAvailable must be boolean');
  }
  assertSafeBoundedString(result.reason, 'reason', {required: false, max: 256});
  if (result.gpuAvailable === false && result.gpus.length !== 0) {
    throw new PayloadResultError('invalid_gpus', 'gpuAvailable false requires empty gpus');
  }
  return result;
}

export function validatePayloadResult(payloadResult) {
  assertPlainObject(payloadResult, 'payload result');
  assertNoForbiddenPayloadResultFields(payloadResult);
  if (payloadResult.type !== 'slaif.payloadResult') {
    throw new PayloadResultError('invalid_type', 'invalid payload result type');
  }
  if (payloadResult.version !== 1) {
    throw new PayloadResultError('invalid_version', 'invalid payload result version');
  }
  if (typeof payloadResult.sessionId !== 'string' || !SESSION_RE.test(payloadResult.sessionId)) {
    throw new PayloadResultError('invalid_session_id', 'invalid sessionId');
  }
  if (typeof payloadResult.hpc !== 'string' || !HPC_RE.test(payloadResult.hpc)) {
    throw new PayloadResultError('invalid_hpc', 'invalid hpc alias');
  }
  if (!ALLOWED_PAYLOAD_IDS.has(payloadResult.payloadId)) {
    throw new PayloadResultError('invalid_payload_id', 'invalid payloadId');
  }
  if (payloadResult.scheduler !== 'slurm') {
    throw new PayloadResultError('invalid_scheduler', 'scheduler must be slurm');
  }
  if (payloadResult.jobId !== undefined &&
      (typeof payloadResult.jobId !== 'string' || !SAFE_SCHEDULER_JOB_ID_RE.test(payloadResult.jobId))) {
    throw new PayloadResultError('invalid_job_id', 'invalid scheduler jobId');
  }
  if (!ALLOWED_STATUSES.has(payloadResult.status)) {
    throw new PayloadResultError('invalid_status', 'invalid payload result status');
  }
  assertPlainObject(payloadResult.result, 'payload result result');
  if (payloadResult.payloadId === 'cpu_memory_diagnostics_v1') {
    validateCpuMemoryDiagnosticsResult(payloadResult.result);
  } else if (payloadResult.payloadId === 'gpu_diagnostics_v1') {
    validateGpuDiagnosticsResult(payloadResult.result);
  }
  return payloadResult;
}

export function parsePayloadResultFromOutput(output, options = {}) {
  const maxOutputBytes = options.maxOutputBytes || 1024 * 1024;
  const maxJsonBytes = options.maxJsonBytes || 65536;
  if (typeof output !== 'string') {
    throw new PayloadResultError('invalid_output', 'output must be a string');
  }
  if (new TextEncoder().encode(output).byteLength > maxOutputBytes) {
    throw new PayloadResultError('oversized_output', 'output exceeds payload result parsing limit');
  }
  const begin = output.indexOf(PAYLOAD_RESULT_BEGIN_MARKER);
  if (begin < 0) {
    throw new PayloadResultError('missing_begin_marker', 'payload result begin marker not found');
  }
  const jsonStart = output.indexOf('\n', begin);
  if (jsonStart < 0) {
    throw new PayloadResultError('missing_result_json', 'payload result JSON missing');
  }
  const end = output.indexOf(PAYLOAD_RESULT_END_MARKER, jsonStart + 1);
  if (end < 0) {
    throw new PayloadResultError('missing_end_marker', 'payload result end marker not found');
  }
  if (output.indexOf(PAYLOAD_RESULT_BEGIN_MARKER, begin + PAYLOAD_RESULT_BEGIN_MARKER.length) >= 0 ||
      output.indexOf(PAYLOAD_RESULT_END_MARKER, end + PAYLOAD_RESULT_END_MARKER.length) >= 0) {
    throw new PayloadResultError('multiple_result_blocks', 'multiple payload result blocks are not allowed');
  }
  const jsonText = output.slice(jsonStart + 1, end).trim();
  if (!jsonText) {
    throw new PayloadResultError('missing_result_json', 'payload result JSON missing');
  }
  if (new TextEncoder().encode(jsonText).byteLength > maxJsonBytes) {
    throw new PayloadResultError('oversized_result_json', 'payload result JSON exceeds limit');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_error) {
    throw new PayloadResultError('malformed_json', 'payload result JSON is malformed');
  }
  return {
    ok: true,
    result: validatePayloadResult(parsed),
  };
}
