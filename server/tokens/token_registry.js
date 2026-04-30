import crypto from 'node:crypto';

export const TOKEN_SCOPES = Object.freeze({
  LAUNCH: 'slaif.launch',
  RELAY: 'slaif.relay',
  JOB_REPORT: 'slaif.jobReport',
});

const DEFAULT_TOKEN_BYTES = 32;
const DEFAULT_FINGERPRINT_LENGTH = 16;

export class TokenRegistryError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TokenRegistryError';
    this.code = code;
  }
}

function nowMs(clock) {
  return Number(clock?.() ?? Date.now());
}

function assertScope(scope) {
  if (!Object.values(TOKEN_SCOPES).includes(scope)) {
    throw new TokenRegistryError('invalid_scope', 'invalid token scope');
  }
  return scope;
}

function assertBindingValue(value, name) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 512) {
    throw new TokenRegistryError(`invalid_${name}`, `invalid ${name}`);
  }
  return value;
}

function cloneRecord(record) {
  if (!record) {
    return null;
  }
  return {
    scope: record.scope,
    sessionId: record.sessionId,
    hpc: record.hpc,
    origin: record.origin,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    maxUses: record.maxUses,
    used: record.used,
    revoked: record.revoked,
    metadata: {...record.metadata},
    fingerprint: record.fingerprint,
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function randomToken(prefix, bytes = DEFAULT_TOKEN_BYTES) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

export function getSafeTokenFingerprint(token, {
  length = DEFAULT_FINGERPRINT_LENGTH,
} = {}) {
  if (typeof token !== 'string' || token.length === 0) {
    return 'token:missing';
  }
  return `sha256:${tokenHash(token).slice(0, length)}`;
}

export function createTokenRegistry(options = {}) {
  const {
    clock = () => Date.now(),
    tokenPrefix = 'slaif_tok',
  } = options;
  const records = new Map();

  function lookup(token) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096) {
      throw new TokenRegistryError('missing_or_malformed_token', 'missing or malformed token');
    }
    const hash = tokenHash(token);
    const record = records.get(hash);
    if (!record) {
      throw new TokenRegistryError('unknown_token', 'unknown token');
    }
    return {hash, record};
  }

  function checkRecord(record, expected = {}) {
    const at = nowMs(clock);
    if (record.revoked) {
      throw new TokenRegistryError('revoked_token', 'revoked token');
    }
    if (record.expiresAt <= at) {
      throw new TokenRegistryError('expired_token', 'expired token');
    }
    if (record.used >= record.maxUses) {
      throw new TokenRegistryError('token_use_exceeded', 'token use exceeded');
    }
    if (expected.scope !== undefined && record.scope !== expected.scope) {
      throw new TokenRegistryError('wrong_scope', 'wrong token scope');
    }
    for (const key of ['sessionId', 'hpc', 'origin']) {
      if (expected[key] !== undefined && record[key] !== expected[key]) {
        throw new TokenRegistryError(`wrong_${key}`, `wrong token ${key}`);
      }
    }
  }

  return {
    issueToken({
      scope,
      sessionId,
      hpc,
      origin,
      ttlMs,
      maxUses = 1,
      metadata = {},
      token,
    }) {
      assertScope(scope);
      const safeTtlMs = Number(ttlMs);
      if (!Number.isInteger(safeTtlMs) || safeTtlMs <= 0) {
        throw new TokenRegistryError('invalid_ttl', 'invalid token ttl');
      }
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) {
        throw new TokenRegistryError('invalid_max_uses', 'invalid token maxUses');
      }
      const value = token || randomToken(tokenPrefix);
      const hash = tokenHash(value);
      if (records.has(hash)) {
        throw new TokenRegistryError('duplicate_token', 'duplicate token');
      }
      const createdAtMs = nowMs(clock);
      const record = {
        scope,
        sessionId: assertBindingValue(sessionId, 'sessionId'),
        hpc: assertBindingValue(hpc, 'hpc'),
        origin: assertBindingValue(origin, 'origin'),
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: createdAtMs + safeTtlMs,
        maxUses,
        used: 0,
        revoked: false,
        metadata: {...metadata},
        fingerprint: getSafeTokenFingerprint(value),
      };
      records.set(hash, record);
      return {
        token: value,
        fingerprint: record.fingerprint,
        expiresAt: new Date(record.expiresAt).toISOString(),
        record: cloneRecord(record),
      };
    },

    validateToken(token, expected = {}) {
      const {record} = lookup(token);
      checkRecord(record, expected);
      return cloneRecord(record);
    },

    consumeToken(token, expected = {}) {
      const {record} = lookup(token);
      checkRecord(record, expected);
      record.used += 1;
      return cloneRecord(record);
    },

    revokeToken(tokenOrFingerprint) {
      if (typeof tokenOrFingerprint !== 'string' || tokenOrFingerprint.length === 0) {
        return false;
      }
      const hash = tokenOrFingerprint.startsWith('sha256:') ?
        null :
        tokenHash(tokenOrFingerprint);
      if (hash && records.has(hash)) {
        records.get(hash).revoked = true;
        return true;
      }
      for (const record of records.values()) {
        if (record.fingerprint === tokenOrFingerprint) {
          record.revoked = true;
          return true;
        }
      }
      return false;
    },

    cleanupExpired() {
      const at = nowMs(clock);
      let removed = 0;
      for (const [hash, record] of records.entries()) {
        if (record.expiresAt <= at) {
          records.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },

    getSafeTokenFingerprint,

    size() {
      return records.size;
    },
  };
}
