export class RateLimitError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
  }
}

export class RateLimiterNotImplementedError extends RateLimitError {
  constructor(mode) {
    super('rate_limiter_not_implemented',
        `${mode} rate limiter is not implemented in this reference package`);
    this.mode = mode;
  }
}

function keyFor({scope = 'default', key}) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    throw new RateLimitError('invalid_rate_limit_key', 'invalid rate limit key');
  }
  if (typeof scope !== 'string' || scope.length === 0 || scope.length > 128) {
    throw new RateLimitError('invalid_rate_limit_scope', 'invalid rate limit scope');
  }
  return `${scope}:${key}`;
}

export function createMemoryRateLimiter({
  windowMs = 60000,
  max = 60,
  clock = () => Date.now(),
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 100) {
    throw new RateLimitError('invalid_rate_limit_window', 'invalid rate limit window');
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new RateLimitError('invalid_rate_limit_max', 'invalid rate limit max');
  }
  const buckets = new Map();

  function currentBucket(input) {
    const id = keyFor(input);
    const now = Number(input.now ?? clock());
    const existing = buckets.get(id);
    if (!existing || existing.resetAt <= now) {
      const fresh = {count: 0, resetAt: now + windowMs};
      buckets.set(id, fresh);
      return {id, bucket: fresh, now};
    }
    return {id, bucket: existing, now};
  }

  return {
    mode: 'memory',
    checkLimit(input) {
      const {bucket} = currentBucket(input);
      return {
        ok: bucket.count < max,
        remaining: Math.max(0, max - bucket.count),
        resetAt: new Date(bucket.resetAt).toISOString(),
      };
    },
    consume(input) {
      const {bucket} = currentBucket(input);
      if (bucket.count >= max) {
        throw new RateLimitError('rate_limit_exceeded', 'rate limit exceeded');
      }
      bucket.count += 1;
      return {
        ok: true,
        remaining: Math.max(0, max - bucket.count),
        resetAt: new Date(bucket.resetAt).toISOString(),
      };
    },
    healthCheck() {
      return {
        ok: true,
        mode: 'memory',
        durable: false,
        sharedAcrossInstances: false,
      };
    },
  };
}

export function createRateLimiter(config = {}, options = {}) {
  const mode = config.mode || config.rateLimitMode || 'memory';
  if (mode === 'memory') {
    return createMemoryRateLimiter({
      windowMs: config.windowMs,
      max: config.max,
      ...options,
    });
  }
  if (mode === 'disabled') {
    return {
      mode: 'disabled',
      checkLimit() {
        return {ok: true, remaining: Number.POSITIVE_INFINITY};
      },
      consume() {
        return {ok: true, remaining: Number.POSITIVE_INFINITY};
      },
      healthCheck() {
        return {ok: true, mode: 'disabled'};
      },
    };
  }
  if (mode === 'external') {
    throw new RateLimiterNotImplementedError(mode);
  }
  throw new RateLimitError('invalid_rate_limit_mode', 'invalid rate limit mode');
}
