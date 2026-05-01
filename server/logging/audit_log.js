import crypto from 'node:crypto';
import {getSafeTokenFingerprint} from '../tokens/token_registry.js';
import {createStdoutAuditSink} from './audit_sink.js';

const TOKEN_FIELD_PATTERN = /token|authorization|password|otp|privatekey|passphrase|secret|redis.*url/i;
const PAYLOAD_FIELD_PATTERN = /payload|transcript|stdout|stderr|terminal|raw|sshPayload|commandOutput/i;
const SAFE_TOKEN_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{8,64}$/i;
const VALID_EVENT_PATTERN = /^[a-z][A-Za-z0-9_.-]{1,96}$/;

export class AuditLogError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuditLogError';
    this.code = code;
  }
}

export function createRequestId(prefix = 'req') {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function timestampFrom(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function sanitizeValue(key, value) {
  if (/tokenFingerprint/i.test(key)) {
    return typeof value === 'string' && SAFE_TOKEN_FINGERPRINT_PATTERN.test(value) ?
      value :
      {redacted: true};
  }
  if (TOKEN_FIELD_PATTERN.test(key)) {
    if (typeof value === 'string' && value.length > 0) {
      return {
        redacted: true,
        fingerprint: getSafeTokenFingerprint(value),
      };
    }
    return {redacted: true};
  }
  if (PAYLOAD_FIELD_PATTERN.test(key)) {
    return {redacted: true};
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(`${key}.${index}`, entry));
  }
  if (value && typeof value === 'object') {
    return sanitizeEvent(value);
  }
  return value;
}

export function sanitizeEvent(event = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(event)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

export function makeAuditEvent(fields = {}, {
  clock = () => new Date(),
  environment,
  includeSessionId = true,
} = {}) {
  const eventName = fields.event || fields.type;
  if (typeof eventName !== 'string' || !VALID_EVENT_PATTERN.test(eventName)) {
    throw new AuditLogError('invalid_audit_event', 'invalid audit event');
  }
  const event = {
    type: 'slaif.auditEvent',
    version: 1,
    event: eventName,
    timestamp: fields.timestamp || timestampFrom(clock),
    requestId: fields.requestId,
    sessionId: includeSessionId ? fields.sessionId : undefined,
    hpc: fields.hpc,
    scope: fields.scope,
    tokenFingerprint: fields.tokenFingerprint,
    outcome: fields.outcome,
    reason: fields.reason || fields.errorCode,
    remoteAddress: fields.remoteAddress,
    durationMs: fields.durationMs,
    environment,
    metadata: fields.metadata,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in event) && key !== 'type') {
      event[key] = value;
    }
  }
  for (const key of Object.keys(event)) {
    if (event[key] === undefined) {
      delete event[key];
    }
  }
  return sanitizeEvent(event);
}

export function createAuditLogger({
  logger = null,
  sink = null,
  clock = () => new Date(),
  environment = 'development',
  includeSessionId = true,
} = {}) {
  const activeSink = sink || (logger ? {
    mode: 'logger',
    write(event) {
      logger.info?.(JSON.stringify(event));
    },
    healthCheck() {
      return {ok: true, mode: 'logger'};
    },
  } : createStdoutAuditSink());

  return {
    sink: activeSink,
    event(type, fields = {}) {
      const event = makeAuditEvent({
        event: type,
        ...fields,
      }, {clock, environment, includeSessionId});
      activeSink.write(event);
      return event;
    },
    healthCheck() {
      if (!activeSink.healthCheck) {
        return {ok: true, mode: activeSink.mode || 'custom'};
      }
      return activeSink.healthCheck();
    },
    flush() {
      return activeSink.flush?.();
    },
    close() {
      return activeSink.close?.();
    },
  };
}
