import {
  createTokenRegistry,
  getSafeTokenFingerprint,
} from './token_registry.js';

export class TokenStoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TokenStoreError';
    this.code = code;
  }
}

export class TokenStoreNotImplementedError extends TokenStoreError {
  constructor(mode) {
    super('token_store_not_implemented',
        `${mode} token store is not implemented in this reference package`);
    this.mode = mode;
  }
}

export function createMemoryTokenStore(options = {}) {
  const registry = options.registry || createTokenRegistry(options);
  return {
    mode: 'memory',
    issueToken(request) {
      return registry.issueToken(request);
    },
    validateToken(token, expected) {
      return registry.validateToken(token, expected);
    },
    consumeToken(token, expected) {
      return registry.consumeToken(token, expected);
    },
    revokeToken(tokenOrFingerprint) {
      return registry.revokeToken(tokenOrFingerprint);
    },
    cleanupExpired() {
      return registry.cleanupExpired();
    },
    healthCheck() {
      return {
        ok: true,
        mode: 'memory',
        durable: false,
        sharedAcrossInstances: false,
      };
    },
    getSafeTokenFingerprint,
  };
}

export function createTokenStore(config = {}, options = {}) {
  const mode = config.mode || config.tokenStore || 'memory';
  if (mode === 'memory') {
    return createMemoryTokenStore(options);
  }
  if (mode === 'redis' || mode === 'postgres') {
    throw new TokenStoreNotImplementedError(mode);
  }
  throw new TokenStoreError('invalid_token_store', 'invalid token store');
}

export const TOKEN_STORE_CONTRACT = Object.freeze({
  requiredOperations: [
    'issueToken',
    'validateToken',
    'consumeToken',
    'revokeToken',
    'cleanupExpired',
    'healthCheck',
    'getSafeTokenFingerprint',
  ],
  productionRequirements: [
    'atomic consume',
    'shared state across API and relay instances',
    'expiry enforcement',
    'scope/session/hpc binding validation',
    'max-use enforcement',
    'safe token fingerprinting',
    'no raw token logging',
  ],
});
