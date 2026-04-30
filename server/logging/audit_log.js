import {getSafeTokenFingerprint} from '../tokens/token_registry.js';

const TOKEN_FIELD_PATTERN = /token|authorization|password|otp|privatekey|passphrase/i;
const PAYLOAD_FIELD_PATTERN = /payload|transcript|stdout|stderr|terminal|raw/i;

function sanitizeValue(key, value) {
  if (/tokenFingerprint/i.test(key)) {
    return value;
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

export function createAuditLogger({logger = console, clock = () => new Date()} = {}) {
  return {
    event(type, fields = {}) {
      const timestamp = clock() instanceof Date ?
        clock().toISOString() :
        new Date(clock()).toISOString();
      const event = sanitizeEvent({
        type,
        timestamp,
        ...fields,
      });
      logger.info?.(JSON.stringify(event));
      return event;
    },
  };
}
