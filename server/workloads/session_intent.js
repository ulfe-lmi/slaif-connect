import {resolveAllowedPayload, validatePayloadId} from './payload_catalog.js';

export const SESSION_INTENT_TYPE = 'slaif.sessionIntent';
export const SESSION_INTENT_VERSION = 1;

const FORBIDDEN_SESSION_INTENT_FIELDS = new Set([
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
  'yoloCommand',
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
  'knownHosts',
  'known_hosts',
  'hostKey',
  'hostKeyAlias',
  'sshHost',
  'sshPort',
  'host',
  'port',
  'Authorization',
  'authorization',
]);

export class SessionIntentError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SessionIntentError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new SessionIntentError('invalid_object', `${name} must be an object`);
  }
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^sess_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new SessionIntentError('invalid_session_id', 'invalid sessionId');
  }
  return sessionId;
}

function validateHpcAlias(hpc) {
  if (typeof hpc !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(hpc)) {
    throw new SessionIntentError('invalid_hpc', 'invalid hpc alias');
  }
  return hpc.toLowerCase();
}

function validateIntentPayloadId(payloadId) {
  try {
    return validatePayloadId(payloadId);
  } catch {
    throw new SessionIntentError('invalid_payload_id', 'invalid payloadId');
  }
}

function parseTimestamp(value, name) {
  if (typeof value !== 'string') {
    throw new SessionIntentError(`invalid_${name}`, `${name} must be an ISO timestamp`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new SessionIntentError(`invalid_${name}`, `${name} must be an ISO timestamp`);
  }
  return time;
}

export function assertNoForbiddenSessionIntentFields(value, path = '') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenSessionIntentFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SESSION_INTENT_FIELDS.has(key)) {
      throw new SessionIntentError(
          'forbidden_session_intent_field',
          `session intent must not include ${path}${key}`,
      );
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenSessionIntentFields(nested, `${path}${key}.`);
    }
  }
}

export function validateSessionIntent(intent, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  assertPlainObject(intent, 'session intent');
  assertNoForbiddenSessionIntentFields(intent);
  if (intent.type !== SESSION_INTENT_TYPE) {
    throw new SessionIntentError('invalid_type', 'invalid session intent type');
  }
  if (intent.version !== SESSION_INTENT_VERSION) {
    throw new SessionIntentError('invalid_version', 'invalid session intent version');
  }
  const sessionId = validateSessionId(intent.sessionId);
  const hpc = validateHpcAlias(intent.hpc);
  const payloadId = validateIntentPayloadId(intent.payloadId);
  const createdAtMs = parseTimestamp(intent.createdAt, 'createdAt');
  const expiresAtMs = parseTimestamp(intent.expiresAt, 'expiresAt');
  if (expiresAtMs <= createdAtMs) {
    throw new SessionIntentError('invalid_expiry', 'expiresAt must be after createdAt');
  }
  if (expiresAtMs <= now) {
    throw new SessionIntentError('expired_intent', 'session intent has expired');
  }
  assertPlainObject(intent.launcher, 'launcher');
  if (intent.launcher.mode !== 'normal') {
    throw new SessionIntentError('invalid_launcher_mode', 'launcher mode must be normal');
  }
  return {
    type: SESSION_INTENT_TYPE,
    version: SESSION_INTENT_VERSION,
    sessionId,
    hpc,
    payloadId,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    launcher: {mode: 'normal'},
  };
}

export function resolveIntentPayload(intent, policyOrCatalog, options = {}) {
  const validated = validateSessionIntent(intent, options);
  if (policyOrCatalog?.hosts) {
    return resolveAllowedPayload(policyOrCatalog, validated.hpc, validated.payloadId);
  }
  return {
    payloadId: validateIntentPayloadId(validated.payloadId),
    payload: policyOrCatalog?.[validated.payloadId],
    hpc: validated.hpc,
  };
}

export function buildSafeSessionIntentSummary(intent, options = {}) {
  const validated = validateSessionIntent(intent, options);
  return {
    type: SESSION_INTENT_TYPE,
    version: SESSION_INTENT_VERSION,
    sessionId: validated.sessionId,
    hpc: validated.hpc,
    payloadId: validated.payloadId,
    expiresAt: validated.expiresAt,
    launcherMode: validated.launcher.mode,
  };
}
