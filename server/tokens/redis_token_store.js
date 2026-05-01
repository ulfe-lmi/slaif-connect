import crypto from 'node:crypto';
import {createClient} from 'redis';
import {
  TOKEN_SCOPES,
  TokenRegistryError,
  getSafeTokenFingerprint,
} from './token_registry.js';
import {TokenStoreError} from './token_store.js';

const DEFAULT_TOKEN_BYTES = 32;
const DEFAULT_PREFIX = 'slaif';
const DEFAULT_EXPIRED_RECORD_GRACE_MS = 60000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;
const MAX_TOKEN_LENGTH = 4096;

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return cjson.encode({ok=false, code='unknown_token'})
end
local record = cjson.decode(value)
local now = tonumber(ARGV[1])
local scope = ARGV[2]
local sessionId = ARGV[3]
local hpc = ARGV[4]
local origin = ARGV[5]
local metadataJson = ARGV[6]
if record.revoked then
  return cjson.encode({ok=false, code='revoked_token'})
end
if tonumber(record.expiresAt) <= now then
  return cjson.encode({ok=false, code='expired_token'})
end
if tonumber(record.used) >= tonumber(record.maxUses) then
  return cjson.encode({ok=false, code='token_use_exceeded'})
end
if scope ~= '' and record.scope ~= scope then
  return cjson.encode({ok=false, code='wrong_scope'})
end
if sessionId ~= '' and record.sessionId ~= sessionId then
  return cjson.encode({ok=false, code='wrong_sessionId'})
end
if hpc ~= '' and record.hpc ~= hpc then
  return cjson.encode({ok=false, code='wrong_hpc'})
end
if origin ~= '' and record.origin ~= origin then
  return cjson.encode({ok=false, code='wrong_origin'})
end
if metadataJson ~= '' then
  local expectedMetadata = cjson.decode(metadataJson)
  for key, value in pairs(expectedMetadata) do
    if record.metadata == nil or record.metadata[key] ~= value then
      return cjson.encode({ok=false, code='wrong_' .. key})
    end
  end
end
record.used = tonumber(record.used) + 1
redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
return cjson.encode({ok=true, record=record})
`;

function nowMs(clock) {
  return Number(clock?.() ?? Date.now());
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function randomToken(prefix, bytes = DEFAULT_TOKEN_BYTES) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
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

function assertTokenValue(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > MAX_TOKEN_LENGTH) {
    throw new TokenRegistryError('missing_or_malformed_token', 'missing or malformed token');
  }
}

export function normalizeRedisKeyPrefix(prefix = DEFAULT_PREFIX) {
  if (typeof prefix !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,64}$/.test(prefix) ||
      prefix.includes('..')) {
    throw new TokenStoreError('invalid_redis_key_prefix', 'invalid Redis key prefix');
  }
  return prefix.replace(/:+$/u, '');
}

function normalizeRedisUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TokenStoreError('missing_redis_url', 'missing Redis URL');
  }
  try {
    const parsed = new URL(url);
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      throw new Error('unsupported Redis URL protocol');
    }
    return parsed.toString();
  } catch (_error) {
    throw new TokenStoreError('invalid_redis_url', 'invalid Redis URL');
  }
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

function parseRecord(value) {
  if (!value) {
    return null;
  }
  try {
    const record = JSON.parse(value);
    return {
      ...record,
      expiresAt: Number(record.expiresAt),
      maxUses: Number(record.maxUses),
      used: Number(record.used),
      revoked: Boolean(record.revoked),
      metadata: record.metadata && typeof record.metadata === 'object' ?
        {...record.metadata} :
        {},
    };
  } catch (_error) {
    throw new TokenStoreError('corrupt_token_record', 'corrupt token record');
  }
}

function checkRecord(record, expected = {}, clock) {
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
  if (expected.metadata !== undefined) {
    if (!expected.metadata || typeof expected.metadata !== 'object' || Array.isArray(expected.metadata)) {
      throw new TokenRegistryError('invalid_metadata_binding', 'invalid token metadata binding');
    }
    for (const [key, value] of Object.entries(expected.metadata)) {
      if (record.metadata?.[key] !== value) {
        throw new TokenRegistryError(`wrong_${key}`, `wrong token ${key}`);
      }
    }
  }
}

function registryErrorFromCode(code) {
  const messages = {
    unknown_token: 'unknown token',
    revoked_token: 'revoked token',
    expired_token: 'expired token',
    token_use_exceeded: 'token use exceeded',
    wrong_scope: 'wrong token scope',
    wrong_sessionId: 'wrong token sessionId',
    wrong_hpc: 'wrong token hpc',
    wrong_origin: 'wrong token origin',
    wrong_payloadId: 'wrong token payloadId',
    wrong_jobId: 'wrong token jobId',
  };
  return new TokenRegistryError(code, messages[code] || code);
}

function createRedisClient(config) {
  const url = normalizeRedisUrl(config.url || config.tokenStoreUrl);
  const parsed = new URL(url);
  const tlsEnabled = Boolean(config.tlsEnabled) || parsed.protocol === 'rediss:';
  return createClient({
    url,
    socket: {
      connectTimeout: Number(config.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS),
      reconnectStrategy: false,
      tls: tlsEnabled ? true : undefined,
    },
    commandTimeout: Number(config.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS),
  });
}

export function createRedisTokenStore(config = {}, options = {}) {
  const {
    clock = () => Date.now(),
    tokenPrefix = 'slaif_tok',
    expiredRecordGraceMs = DEFAULT_EXPIRED_RECORD_GRACE_MS,
    auditLogger = null,
    metricsRegistry = null,
  } = options;
  const client = options.client || config.client || createRedisClient(config);
  client.on?.('error', () => {
    // Connection errors are surfaced through operation results/health checks.
  });
  const ownsClient = !(options.client || config.client);
  const keyPrefix = normalizeRedisKeyPrefix(
      config.redisKeyPrefix || config.keyPrefix || DEFAULT_PREFIX,
  );

  function keyForHash(hash) {
    return `${keyPrefix}:token:${hash}`;
  }

  function audit(event, fields = {}) {
    auditLogger?.event?.(event, fields);
  }

  function metric(name, labels = {}) {
    metricsRegistry?.increment?.(name, {
      tokenStoreType: 'redis',
      ...labels,
    });
  }

  function keyForToken(token) {
    assertTokenValue(token);
    return keyForHash(tokenHash(token));
  }

  async function ensureConnected() {
    if (!client.isOpen) {
      await client.connect();
    }
  }

  async function getRecordByToken(token) {
    const key = keyForToken(token);
    await ensureConnected();
    const record = parseRecord(await client.get(key));
    if (!record) {
      throw new TokenRegistryError('unknown_token', 'unknown token');
    }
    return {key, record};
  }

  async function setRecord(key, record) {
    const ttlMs = Math.max(1, record.expiresAt - nowMs(clock) + expiredRecordGraceMs);
    await client.set(key, JSON.stringify(record), {PX: ttlMs});
  }

  async function findKeyByFingerprint(fingerprint) {
    await ensureConnected();
    for await (const entry of client.scanIterator({MATCH: `${keyPrefix}:token:*`, COUNT: 100})) {
      const keys = Array.isArray(entry) ? entry : [entry];
      for (const key of keys) {
        const record = parseRecord(await client.get(key));
        if (record?.fingerprint === fingerprint) {
          return {key, record};
        }
      }
    }
    return null;
  }

  return {
    mode: 'redis',

    async issueToken({
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
      assertTokenValue(value);
      const hash = tokenHash(value);
      const key = keyForHash(hash);
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
      await ensureConnected();
      const ttlWithGrace = safeTtlMs + expiredRecordGraceMs;
      const result = await client.set(key, JSON.stringify(record), {
        PX: ttlWithGrace,
        NX: true,
      });
      if (result !== 'OK') {
        throw new TokenRegistryError('duplicate_token', 'duplicate token');
      }
      audit('token.issued', {
        scope,
        sessionId: record.sessionId,
        hpc: record.hpc,
        tokenFingerprint: record.fingerprint,
        outcome: 'issued',
      });
      metric('slaif_tokens_issued_total', {scope, outcome: 'issued'});
      return {
        token: value,
        fingerprint: record.fingerprint,
        expiresAt: new Date(record.expiresAt).toISOString(),
        record: cloneRecord(record),
      };
    },

    async validateToken(token, expected = {}) {
      try {
        const {record} = await getRecordByToken(token);
        checkRecord(record, expected, clock);
        audit('token.validated', {
          scope: record.scope,
          sessionId: record.sessionId,
          hpc: record.hpc,
          tokenFingerprint: record.fingerprint,
          outcome: 'accepted',
        });
        return cloneRecord(record);
      } catch (error) {
        audit('token.rejected', {
          scope: expected.scope,
          sessionId: expected.sessionId,
          hpc: expected.hpc,
          tokenFingerprint: getSafeTokenFingerprint(token),
          outcome: 'rejected',
          reason: error.code || 'token_validation_failed',
        });
        metric('slaif_tokens_rejected_total', {
          scope: expected.scope || 'unknown',
          outcome: 'rejected',
          reason: error.code || 'token_validation_failed',
        });
        throw error;
      }
    },

    async consumeToken(token, expected = {}) {
      try {
        const key = keyForToken(token);
        await ensureConnected();
        const raw = await client.eval(CONSUME_SCRIPT, {
          keys: [key],
          arguments: [
            String(nowMs(clock)),
            expected.scope || '',
            expected.sessionId || '',
            expected.hpc || '',
            expected.origin || '',
            expected.metadata ? JSON.stringify(expected.metadata) : '',
          ],
        });
        const result = JSON.parse(raw);
        if (!result.ok) {
          throw registryErrorFromCode(result.code);
        }
        const record = parseRecord(JSON.stringify(result.record));
        audit('token.consumed', {
          scope: record.scope,
          sessionId: record.sessionId,
          hpc: record.hpc,
          tokenFingerprint: record.fingerprint,
          outcome: 'accepted',
        });
        metric('slaif_tokens_consumed_total', {scope: record.scope, outcome: 'accepted'});
        return cloneRecord(record);
      } catch (error) {
        audit('token.rejected', {
          scope: expected.scope,
          sessionId: expected.sessionId,
          hpc: expected.hpc,
          tokenFingerprint: getSafeTokenFingerprint(token),
          outcome: 'rejected',
          reason: error.code || 'token_consume_failed',
        });
        metric('slaif_tokens_rejected_total', {
          scope: expected.scope || 'unknown',
          outcome: 'rejected',
          reason: error.code || 'token_consume_failed',
        });
        throw error;
      }
    },

    async revokeToken(tokenOrFingerprint) {
      if (typeof tokenOrFingerprint !== 'string' || tokenOrFingerprint.length === 0) {
        return false;
      }
      let entry;
      if (tokenOrFingerprint.startsWith('sha256:')) {
        entry = await findKeyByFingerprint(tokenOrFingerprint);
      } else {
        try {
          entry = await getRecordByToken(tokenOrFingerprint);
        } catch (error) {
          if (error.code === 'unknown_token' ||
              error.code === 'missing_or_malformed_token') {
            return false;
          }
          throw error;
        }
      }
      if (!entry) {
        return false;
      }
      entry.record.revoked = true;
      await setRecord(entry.key, entry.record);
      audit('token.revoked', {
        tokenFingerprint: entry.record.fingerprint,
        scope: entry.record.scope,
        sessionId: entry.record.sessionId,
        hpc: entry.record.hpc,
        outcome: 'revoked',
      });
      return true;
    },

    async cleanupExpired() {
      await ensureConnected();
      let removed = 0;
      const at = nowMs(clock);
      for await (const entry of client.scanIterator({MATCH: `${keyPrefix}:token:*`, COUNT: 100})) {
        const keys = Array.isArray(entry) ? entry : [entry];
        for (const key of keys) {
          const record = parseRecord(await client.get(key));
          if (record?.expiresAt <= at) {
            await client.del(key);
            removed += 1;
          }
        }
      }
      return removed;
    },

    async healthCheck() {
      try {
        await ensureConnected();
        const pong = await client.ping();
        return {
          ok: pong === 'PONG',
          mode: 'redis',
          durable: true,
          sharedAcrossInstances: true,
          keyPrefix,
        };
      } catch (error) {
        return {
          ok: false,
          mode: 'redis',
          durable: true,
          sharedAcrossInstances: true,
          errorCode: error.code || 'redis_health_check_failed',
        };
      }
    },

    getSafeTokenFingerprint,

    async close() {
      if (client.isOpen) {
        if (ownsClient && typeof client.quit === 'function') {
          await client.quit();
        } else if (typeof client.close === 'function') {
          await client.close();
        } else if (typeof client.disconnect === 'function') {
          await client.disconnect();
        }
      }
    },

    _unsafeDebugKeyForToken(token) {
      return keyForToken(token);
    },
  };
}
