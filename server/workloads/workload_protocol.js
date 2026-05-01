export const WORKLOAD_TOKEN_SCOPE = 'slaif.workload';

export const WORKLOAD_MESSAGE_TYPES = Object.freeze({
  HELLO: 'slaif.workload.hello',
  PROMPT: 'slaif.prompt',
  RESPONSE_DELTA: 'slaif.response.delta',
  RESPONSE_DONE: 'slaif.response.done',
  STOP: 'slaif.workload.stop',
  ERROR: 'slaif.workload.error',
});

export const ALLOWED_PAYLOAD_IDS = Object.freeze([
  'gpu_diagnostics_v1',
  'cpu_memory_diagnostics_v1',
  'gams_chat_v1',
]);

export const ALLOWED_WORKLOAD_RUNTIMES = Object.freeze([
  'vllm',
  'diagnostic',
  'mock',
]);

export const ALLOWED_MODEL_IDENTIFIERS = Object.freeze([
  'cjvt/GaMS3-12B-Instruct',
  'mock-gams',
]);

export const DEFAULT_WORKLOAD_LIMITS = Object.freeze({
  maxMessages: 16,
  maxPromptBytes: 16 * 1024,
  maxResponseDeltaBytes: 4096,
  maxErrorMessageBytes: 1024,
  maxTokens: 4096,
  maxUsageTokens: 1_000_000_000,
});

const FORBIDDEN_WORKLOAD_FIELDS = new Set([
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
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
]);

const ALLOWED_PROMPT_ROLES = new Set(['system', 'user', 'assistant']);
const ALLOWED_FINISH_REASONS = new Set(['stop', 'length', 'cancelled', 'error', 'content_filter']);
const ALLOWED_STOP_REASONS = new Set([
  'user_cancelled',
  'idle_timeout',
  'max_runtime',
  'server_shutdown',
  'policy_violation',
  'worker_error',
]);

export class WorkloadProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'WorkloadProtocolError';
    this.code = code;
  }
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function assertObject(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new WorkloadProtocolError('invalid_message', 'workload message must be an object');
  }
}

function assertTypeAndVersion(message, expectedType) {
  assertObject(message);
  assertNoForbiddenWorkloadFields(message);
  if (message.type !== expectedType) {
    throw new WorkloadProtocolError('wrong_type', 'wrong workload message type');
  }
  if (message.version !== 1) {
    throw new WorkloadProtocolError('wrong_version', 'wrong workload message version');
  }
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^sess_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new WorkloadProtocolError('invalid_session_id', 'invalid sessionId');
  }
  return sessionId;
}

function validateHpcAlias(hpc) {
  if (typeof hpc !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(hpc)) {
    throw new WorkloadProtocolError('invalid_hpc', 'invalid hpc alias');
  }
  return hpc.toLowerCase();
}

export function validatePayloadId(payloadId) {
  if (!ALLOWED_PAYLOAD_IDS.includes(payloadId)) {
    throw new WorkloadProtocolError('invalid_payload_id', 'invalid payloadId');
  }
  return payloadId;
}

function validateJobId(jobId, {required = false} = {}) {
  if (jobId === undefined || jobId === null || jobId === '') {
    if (required) {
      throw new WorkloadProtocolError('missing_job_id', 'missing jobId');
    }
    return undefined;
  }
  if (typeof jobId !== 'string' || !/^[0-9]{1,32}$/.test(jobId)) {
    throw new WorkloadProtocolError('invalid_job_id', 'invalid jobId');
  }
  return jobId;
}

function validatePromptId(promptId) {
  if (typeof promptId !== 'string' || !/^prompt_[A-Za-z0-9_-]{1,128}$/.test(promptId)) {
    throw new WorkloadProtocolError('invalid_prompt_id', 'invalid promptId');
  }
  return promptId;
}

function validateExpected(message, expected = {}) {
  for (const key of ['sessionId', 'hpc', 'payloadId', 'jobId', 'promptId']) {
    if (expected[key] !== undefined && message[key] !== expected[key]) {
      throw new WorkloadProtocolError(`wrong_${key}`, `wrong ${key}`);
    }
  }
}

function assertBoundedString(value, name, maxBytes) {
  if (typeof value !== 'string') {
    throw new WorkloadProtocolError(`invalid_${name}`, `invalid ${name}`);
  }
  if (byteLength(value) > maxBytes) {
    throw new WorkloadProtocolError(`${name}_too_large`, `${name} too large`);
  }
  return value;
}

function validatePromptOptions(options = {}, limits) {
  if (options === undefined) {
    return {};
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new WorkloadProtocolError('invalid_options', 'invalid prompt options');
  }
  assertNoForbiddenWorkloadFields(options);
  const normalized = {};
  if (options.maxTokens !== undefined) {
    if (!Number.isInteger(options.maxTokens) ||
        options.maxTokens < 1 ||
        options.maxTokens > limits.maxTokens) {
      throw new WorkloadProtocolError('invalid_max_tokens', 'invalid maxTokens');
    }
    normalized.maxTokens = options.maxTokens;
  }
  if (options.temperature !== undefined) {
    if (typeof options.temperature !== 'number' ||
        !Number.isFinite(options.temperature) ||
        options.temperature < 0 ||
        options.temperature > 2) {
      throw new WorkloadProtocolError('invalid_temperature', 'invalid temperature');
    }
    normalized.temperature = options.temperature;
  }
  if (options.topP !== undefined) {
    if (typeof options.topP !== 'number' ||
        !Number.isFinite(options.topP) ||
        options.topP < 0 ||
        options.topP > 1) {
      throw new WorkloadProtocolError('invalid_top_p', 'invalid topP');
    }
    normalized.topP = options.topP;
  }
  return normalized;
}

function assertNoStackTrace(value) {
  if (/\n\s*at\s+\S+/u.test(value) || /^(Error|TypeError|ReferenceError):/u.test(value)) {
    throw new WorkloadProtocolError('unsafe_error_message', 'unsafe error message');
  }
}

export function assertNoForbiddenWorkloadFields(message, path = '') {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (Array.isArray(message)) {
    message.forEach((entry, index) => assertNoForbiddenWorkloadFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, value] of Object.entries(message)) {
    if (FORBIDDEN_WORKLOAD_FIELDS.has(key)) {
      throw new WorkloadProtocolError('forbidden_workload_field',
          `forbidden workload field ${path}${key}`);
    }
    if (value && typeof value === 'object') {
      assertNoForbiddenWorkloadFields(value, `${path}${key}.`);
    }
  }
}

export function validateWorkloadHello(message, expected = {}) {
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.HELLO);
  validateSessionId(message.sessionId);
  validateHpcAlias(message.hpc);
  validatePayloadId(message.payloadId);
  validateJobId(message.jobId);
  if (!ALLOWED_WORKLOAD_RUNTIMES.includes(message.runtime)) {
    throw new WorkloadProtocolError('invalid_runtime', 'invalid workload runtime');
  }
  if (message.model !== undefined && !ALLOWED_MODEL_IDENTIFIERS.includes(message.model)) {
    throw new WorkloadProtocolError('invalid_model', 'invalid model identifier');
  }
  if (message.payloadId === 'gams_chat_v1' && message.model === undefined) {
    throw new WorkloadProtocolError('missing_model', 'missing model identifier');
  }
  validateExpected(message, expected);
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    hpc: message.hpc.toLowerCase(),
    payloadId: message.payloadId,
    jobId: message.jobId,
    runtime: message.runtime,
    model: message.model,
  };
}

export function validatePromptMessage(message, limits = {}) {
  const activeLimits = {...DEFAULT_WORKLOAD_LIMITS, ...limits};
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.PROMPT);
  validateSessionId(message.sessionId);
  validatePromptId(message.promptId);
  if (!Array.isArray(message.messages) ||
      message.messages.length < 1 ||
      message.messages.length > activeLimits.maxMessages) {
    throw new WorkloadProtocolError('invalid_messages', 'invalid prompt messages');
  }
  let totalBytes = 0;
  const messages = message.messages.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new WorkloadProtocolError('invalid_prompt_message', 'invalid prompt message');
    }
    assertNoForbiddenWorkloadFields(entry);
    if (!ALLOWED_PROMPT_ROLES.has(entry.role)) {
      throw new WorkloadProtocolError('invalid_role', 'invalid prompt role');
    }
    const content = assertBoundedString(entry.content, 'content', activeLimits.maxPromptBytes);
    totalBytes += byteLength(content);
    if (totalBytes > activeLimits.maxPromptBytes) {
      throw new WorkloadProtocolError('prompt_too_large', 'prompt too large');
    }
    return {role: entry.role, content};
  });
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    promptId: message.promptId,
    messages,
    options: validatePromptOptions(message.options || {}, activeLimits),
  };
}

export function validateResponseDelta(message, expected = {}, limits = {}) {
  const activeLimits = {...DEFAULT_WORKLOAD_LIMITS, ...limits};
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.RESPONSE_DELTA);
  validateSessionId(message.sessionId);
  validatePromptId(message.promptId);
  assertBoundedString(message.text, 'text', activeLimits.maxResponseDeltaBytes);
  validateExpected(message, expected);
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    promptId: message.promptId,
    text: message.text,
  };
}

export function validateResponseDone(message, expected = {}, limits = {}) {
  const activeLimits = {...DEFAULT_WORKLOAD_LIMITS, ...limits};
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.RESPONSE_DONE);
  validateSessionId(message.sessionId);
  validatePromptId(message.promptId);
  if (!ALLOWED_FINISH_REASONS.has(message.finishReason)) {
    throw new WorkloadProtocolError('invalid_finish_reason', 'invalid finishReason');
  }
  if (message.usage !== undefined) {
    if (!message.usage || typeof message.usage !== 'object' || Array.isArray(message.usage)) {
      throw new WorkloadProtocolError('invalid_usage', 'invalid usage');
    }
    for (const key of ['inputTokens', 'outputTokens']) {
      if (message.usage[key] !== undefined &&
          (!Number.isInteger(message.usage[key]) ||
           message.usage[key] < 0 ||
           message.usage[key] > activeLimits.maxUsageTokens)) {
        throw new WorkloadProtocolError('invalid_usage', 'invalid usage');
      }
    }
  }
  validateExpected(message, expected);
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    promptId: message.promptId,
    finishReason: message.finishReason,
    usage: message.usage ? {...message.usage} : undefined,
  };
}

export function validateStopMessage(message, expected = {}) {
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.STOP);
  validateSessionId(message.sessionId);
  if (!ALLOWED_STOP_REASONS.has(message.reason)) {
    throw new WorkloadProtocolError('invalid_stop_reason', 'invalid stop reason');
  }
  validateExpected(message, expected);
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    reason: message.reason,
  };
}

export function validateWorkloadError(message, expected = {}, limits = {}) {
  const activeLimits = {...DEFAULT_WORKLOAD_LIMITS, ...limits};
  assertTypeAndVersion(message, WORKLOAD_MESSAGE_TYPES.ERROR);
  validateSessionId(message.sessionId);
  if (typeof message.code !== 'string' || !/^[a-z][a-z0-9_]{1,64}$/.test(message.code)) {
    throw new WorkloadProtocolError('invalid_error_code', 'invalid workload error code');
  }
  const safeMessage = assertBoundedString(
      message.message,
      'error_message',
      activeLimits.maxErrorMessageBytes,
  );
  assertNoStackTrace(safeMessage);
  validateExpected(message, expected);
  return {
    type: message.type,
    version: 1,
    sessionId: message.sessionId,
    code: message.code,
    message: safeMessage,
  };
}
