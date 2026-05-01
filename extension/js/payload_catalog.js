export const ALLOWED_MVP_PAYLOAD_IDS = Object.freeze([
  'gpu_diagnostics_v1',
  'cpu_memory_diagnostics_v1',
  'gams_chat_v1',
]);

export const ALLOWED_PAYLOAD_TYPES = Object.freeze([
  'fast_diagnostic',
  'interactive_llm',
]);

export const ALLOWED_PAYLOAD_SCHEDULERS = Object.freeze(['slurm']);

export const ALLOWED_LLM_MODELS = Object.freeze([
  'cjvt/GaMS3-12B-Instruct',
  'mock-gams',
]);

export const ALLOWED_LLM_RUNTIMES = Object.freeze([
  'vllm',
  'mock',
]);

const FORBIDDEN_PAYLOAD_FIELDS = new Set([
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
  'endpointUrl',
  'brokerUrl',
  'apiUrl',
  'workerUrl',
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

const SAFE_SCHEMA_RE = /^slaif\.[A-Za-z0-9_.-]{1,96}$/;

export class PayloadCatalogError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PayloadCatalogError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new PayloadCatalogError('invalid_object', `${name} must be an object`);
  }
}

function assertPositiveInteger(value, name, max) {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new PayloadCatalogError(`invalid_${name}`, `${name} is invalid`);
  }
  return value;
}

export function validatePayloadId(payloadId) {
  if (typeof payloadId !== 'string' ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(payloadId) ||
      !ALLOWED_MVP_PAYLOAD_IDS.includes(payloadId)) {
    throw new PayloadCatalogError('invalid_payload_id', 'invalid payloadId');
  }
  return payloadId;
}

export function assertNoForbiddenPayloadFields(value, path = '') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenPayloadFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_FIELDS.has(key)) {
      throw new PayloadCatalogError(
          'forbidden_payload_field',
          `payload catalog must not include ${path}${key}`,
      );
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenPayloadFields(nested, `${path}${key}.`);
    }
  }
}

function validateCommonPayload(payloadId, payload) {
  assertPlainObject(payload, `payload ${payloadId}`);
  assertNoForbiddenPayloadFields(payload);
  if (!ALLOWED_PAYLOAD_TYPES.includes(payload.type)) {
    throw new PayloadCatalogError('invalid_payload_type', `payload ${payloadId} has invalid type`);
  }
  if (!ALLOWED_PAYLOAD_SCHEDULERS.includes(payload.scheduler)) {
    throw new PayloadCatalogError('invalid_scheduler', `payload ${payloadId} has invalid scheduler`);
  }
}

function validateFastDiagnostic(payloadId, payload) {
  assertPositiveInteger(payload.maxRuntimeSeconds, 'maxRuntimeSeconds', 3600);
  assertPositiveInteger(payload.maxOutputBytes, 'maxOutputBytes', 1048576);
  if (typeof payload.requiresGpu !== 'boolean') {
    throw new PayloadCatalogError('invalid_requires_gpu', `payload ${payloadId} requiresGpu must be boolean`);
  }
  if (typeof payload.resultSchema !== 'string' || !SAFE_SCHEMA_RE.test(payload.resultSchema)) {
    throw new PayloadCatalogError('invalid_result_schema', `payload ${payloadId} has invalid resultSchema`);
  }
}

function validateInteractiveLlm(payloadId, payload) {
  if (!ALLOWED_LLM_MODELS.includes(payload.model)) {
    throw new PayloadCatalogError('invalid_model', `payload ${payloadId} has invalid model`);
  }
  if (!ALLOWED_LLM_RUNTIMES.includes(payload.runtime)) {
    throw new PayloadCatalogError('invalid_runtime', `payload ${payloadId} has invalid runtime`);
  }
  if (payloadId === 'gams_chat_v1' && payload.requiresGpu !== true) {
    throw new PayloadCatalogError('invalid_requires_gpu', 'gams_chat_v1 requires GPU resources');
  }
  if (payload.requiresOutboundWorkloadConnection !== true) {
    throw new PayloadCatalogError(
        'invalid_outbound_connection',
        `payload ${payloadId} must require outbound workload connection`,
    );
  }
  assertPositiveInteger(payload.maxSessionSeconds, 'maxSessionSeconds', 24 * 60 * 60);
  assertPositiveInteger(payload.idleTimeoutSeconds, 'idleTimeoutSeconds', 3600);
  if (payload.idleTimeoutSeconds > payload.maxSessionSeconds) {
    throw new PayloadCatalogError('invalid_idle_timeout', 'idleTimeoutSeconds exceeds maxSessionSeconds');
  }
  assertPositiveInteger(payload.maxPromptBytes, 'maxPromptBytes', 262144);
  assertPositiveInteger(payload.maxOutputTokens, 'maxOutputTokens', 32768);
}

export function validatePayloadDefinition(payloadId, payload) {
  validatePayloadId(payloadId);
  validateCommonPayload(payloadId, payload);
  if (payload.type === 'fast_diagnostic') {
    validateFastDiagnostic(payloadId, payload);
  } else if (payload.type === 'interactive_llm') {
    validateInteractiveLlm(payloadId, payload);
  }
  return payload;
}

export function validatePayloadCatalog(catalog) {
  assertPlainObject(catalog, 'allowedPayloads');
  const entries = Object.entries(catalog);
  if (entries.length === 0) {
    throw new PayloadCatalogError('empty_payload_catalog', 'allowedPayloads must be non-empty');
  }
  for (const [payloadId, payload] of entries) {
    validatePayloadDefinition(payloadId, payload);
  }
  return catalog;
}

export function validateHostPayloadRefs(host, catalog, {alias = 'host'} = {}) {
  assertPlainObject(host, `policy host ${alias}`);
  validatePayloadCatalog(catalog);
  if (!Array.isArray(host.allowedPayloadIds) || host.allowedPayloadIds.length === 0) {
    throw new PayloadCatalogError(
        'missing_allowed_payload_ids',
        `policy host ${alias} must include non-empty allowedPayloadIds`,
    );
  }
  const seen = new Set();
  for (const payloadId of host.allowedPayloadIds) {
    validatePayloadId(payloadId);
    if (seen.has(payloadId)) {
      throw new PayloadCatalogError('duplicate_payload_id', `duplicate payloadId ${payloadId}`);
    }
    seen.add(payloadId);
    if (!Object.hasOwn(catalog, payloadId)) {
      throw new PayloadCatalogError(
          'unknown_payload_reference',
          `policy host ${alias} references missing payload ${payloadId}`,
      );
    }
  }
  return host.allowedPayloadIds;
}

export function resolveAllowedPayload(policy, hpcAlias, payloadId) {
  if (!policy || typeof policy !== 'object') {
    throw new PayloadCatalogError('invalid_policy', 'policy must be an object');
  }
  const safePayloadId = validatePayloadId(payloadId);
  const safeAlias = typeof hpcAlias === 'string' ? hpcAlias.toLowerCase() : hpcAlias;
  if (typeof safeAlias !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(safeAlias)) {
    throw new PayloadCatalogError('invalid_hpc', 'invalid hpc alias');
  }
  validatePayloadCatalog(policy.allowedPayloads);
  const host = policy.hosts?.[safeAlias];
  if (!host) {
    throw new PayloadCatalogError('unknown_hpc', 'unknown hpc alias');
  }
  validateHostPayloadRefs(host, policy.allowedPayloads, {alias: safeAlias});
  if (!host.allowedPayloadIds.includes(safePayloadId)) {
    throw new PayloadCatalogError('payload_not_allowed', 'payloadId is not allowed for this hpc alias');
  }
  return {
    payloadId: safePayloadId,
    payload: policy.allowedPayloads[safePayloadId],
    hpc: safeAlias,
    host,
  };
}

export function buildDefaultPayloadCatalog() {
  return {
    gpu_diagnostics_v1: {
      type: 'fast_diagnostic',
      scheduler: 'slurm',
      requiresGpu: true,
      maxRuntimeSeconds: 300,
      maxOutputBytes: 65536,
      resultSchema: 'slaif.gpuDiagnosticsResult.v1',
    },
    cpu_memory_diagnostics_v1: {
      type: 'fast_diagnostic',
      scheduler: 'slurm',
      requiresGpu: false,
      maxRuntimeSeconds: 300,
      maxOutputBytes: 65536,
      resultSchema: 'slaif.cpuMemoryDiagnosticsResult.v1',
    },
    gams_chat_v1: {
      type: 'interactive_llm',
      scheduler: 'slurm',
      model: 'cjvt/GaMS3-12B-Instruct',
      runtime: 'vllm',
      requiresGpu: true,
      requiresOutboundWorkloadConnection: true,
      maxSessionSeconds: 3600,
      idleTimeoutSeconds: 300,
      maxPromptBytes: 16000,
      maxOutputTokens: 1024,
    },
  };
}
