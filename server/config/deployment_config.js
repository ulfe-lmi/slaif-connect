import fs from 'node:fs';

export class DeploymentConfigError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'DeploymentConfigError';
    this.code = code;
  }
}

const ENVIRONMENTS = new Set(['development', 'test', 'local-pilot', 'production']);
const TOKEN_STORES = new Set(['memory', 'redis', 'postgres']);
const AUDIT_MODES = new Set(['stdout', 'file', 'external', 'disabled']);
const RATE_LIMIT_MODES = new Set(['disabled', 'memory', 'external']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const DEFAULTS = Object.freeze({
  env: 'development',
  relayMaxAuthBytes: 4096,
  relayUnauthTimeoutMs: 10000,
  relayIdleTimeoutMs: 300000,
  relayAbsoluteTimeoutMs: 3600000,
  jobReportMaxBytes: 16384,
  tokenStore: 'memory',
  auditLogMode: 'stdout',
  rateLimitMode: 'memory',
  allowSingleInstancePilot: false,
});

function coalesce(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new DeploymentConfigError(`invalid_${name}`, `invalid ${name}`);
  }
  return parsed;
}

function listFrom(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeUrl(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeploymentConfigError(`missing_${name}`, `missing ${name}`);
  }
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch (_error) {
    throw new DeploymentConfigError(`invalid_${name}`, `invalid ${name}`);
  }
}

function normalizeOrigin(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeploymentConfigError(`missing_${name}`, `missing ${name}`);
  }
  if (value.includes('*')) {
    throw new DeploymentConfigError(`wildcard_${name}`, `wildcard ${name} is not allowed`);
  }
  try {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error('origin must not include path');
    }
    return url.origin;
  } catch (_error) {
    throw new DeploymentConfigError(`invalid_${name}`, `invalid ${name}`);
  }
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return LOCAL_HOSTS.has(url.hostname);
  } catch (_error) {
    return false;
  }
}

function requireProtocol(value, allowed, name, {allowLocalInsecure = false} = {}) {
  const url = new URL(value);
  if (allowed.includes(url.protocol)) {
    return;
  }
  if (allowLocalInsecure && isLocalUrl(value) &&
      ['http:', 'ws:'].includes(url.protocol)) {
    return;
  }
  throw new DeploymentConfigError(`unsafe_${name}_protocol`, `unsafe ${name} protocol`);
}

function assertPositiveBounded(value, name, {min = 1, max}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DeploymentConfigError(`unsafe_${name}`, `unsafe ${name}`);
  }
}

function loadJsonConfig(configFile) {
  if (!configFile) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

export function loadDeploymentConfig({
  env = process.env,
  configFile,
  modeOverrides = {},
} = {}) {
  const fileConfig = loadJsonConfig(configFile || env.SLAIF_DEPLOYMENT_CONFIG_FILE);
  const config = {
    env: coalesce(modeOverrides.env, fileConfig.env, env.SLAIF_ENV, DEFAULTS.env),
    apiBaseUrl: coalesce(fileConfig.apiBaseUrl, env.SLAIF_API_BASE_URL),
    relayPublicUrl: coalesce(fileConfig.relayPublicUrl, env.SLAIF_RELAY_PUBLIC_URL),
    allowedWebOrigins: listFrom(coalesce(
        fileConfig.allowedWebOrigins,
        env.SLAIF_ALLOWED_WEB_ORIGINS,
    )),
    allowedRelayTargetsFile: coalesce(
        fileConfig.allowedRelayTargetsFile,
        env.SLAIF_ALLOWED_RELAY_TARGETS_FILE,
    ),
    tokenStore: coalesce(fileConfig.tokenStore, env.SLAIF_TOKEN_STORE, DEFAULTS.tokenStore),
    tokenStoreUrl: coalesce(fileConfig.tokenStoreUrl, env.SLAIF_TOKEN_STORE_URL),
    auditLogMode: coalesce(
        fileConfig.auditLogMode,
        env.SLAIF_AUDIT_LOG_MODE,
        DEFAULTS.auditLogMode,
    ),
    auditLogPath: coalesce(fileConfig.auditLogPath, env.SLAIF_AUDIT_LOG_PATH),
    relayMaxAuthBytes: parseInteger(coalesce(
        fileConfig.relayMaxAuthBytes,
        env.SLAIF_RELAY_MAX_AUTH_BYTES,
        DEFAULTS.relayMaxAuthBytes,
    ), 'relayMaxAuthBytes'),
    relayUnauthTimeoutMs: parseInteger(coalesce(
        fileConfig.relayUnauthTimeoutMs,
        env.SLAIF_RELAY_UNAUTH_TIMEOUT_MS,
        DEFAULTS.relayUnauthTimeoutMs,
    ), 'relayUnauthTimeoutMs'),
    relayIdleTimeoutMs: parseInteger(coalesce(
        fileConfig.relayIdleTimeoutMs,
        env.SLAIF_RELAY_IDLE_TIMEOUT_MS,
        DEFAULTS.relayIdleTimeoutMs,
    ), 'relayIdleTimeoutMs'),
    relayAbsoluteTimeoutMs: parseInteger(coalesce(
        fileConfig.relayAbsoluteTimeoutMs,
        env.SLAIF_RELAY_ABSOLUTE_TIMEOUT_MS,
        DEFAULTS.relayAbsoluteTimeoutMs,
    ), 'relayAbsoluteTimeoutMs'),
    jobReportMaxBytes: parseInteger(coalesce(
        fileConfig.jobReportMaxBytes,
        env.SLAIF_JOB_REPORT_MAX_BYTES,
        DEFAULTS.jobReportMaxBytes,
    ), 'jobReportMaxBytes'),
    rateLimitMode: coalesce(
        fileConfig.rateLimitMode,
        env.SLAIF_RATE_LIMIT_MODE,
        DEFAULTS.rateLimitMode,
    ),
    policyTrustRootsFile: coalesce(
        fileConfig.policyTrustRootsFile,
        env.SLAIF_POLICY_TRUST_ROOTS_FILE,
    ),
    signedPolicyFile: coalesce(fileConfig.signedPolicyFile, env.SLAIF_SIGNED_POLICY_FILE),
    allowSingleInstancePilot: parseBoolean(coalesce(
        modeOverrides.allowSingleInstancePilot,
        fileConfig.allowSingleInstancePilot,
        env.SLAIF_ALLOW_SINGLE_INSTANCE_PILOT,
        DEFAULTS.allowSingleInstancePilot,
    )),
  };
  return validateDeploymentConfig(config);
}

export function validateDeploymentConfig(config) {
  const normalized = {...config};
  if (!ENVIRONMENTS.has(normalized.env)) {
    throw new DeploymentConfigError('invalid_env', 'invalid environment');
  }
  const production = normalized.env === 'production';
  const allowLocalInsecure = !production;

  normalized.apiBaseUrl = normalizeUrl(normalized.apiBaseUrl, 'apiBaseUrl');
  normalized.relayPublicUrl = normalizeUrl(normalized.relayPublicUrl, 'relayPublicUrl');
  requireProtocol(normalized.apiBaseUrl, ['https:'], 'apiBaseUrl', {allowLocalInsecure});
  requireProtocol(normalized.relayPublicUrl, ['wss:'], 'relayPublicUrl', {allowLocalInsecure});

  normalized.allowedWebOrigins = listFrom(normalized.allowedWebOrigins)
      .map((origin) => normalizeOrigin(origin, 'allowedWebOrigin'));
  if (normalized.allowedWebOrigins.length === 0) {
    throw new DeploymentConfigError('missing_allowed_web_origins',
        'missing allowed web origins');
  }
  for (const origin of normalized.allowedWebOrigins) {
    requireProtocol(origin, ['https:'], 'allowedWebOrigin', {allowLocalInsecure});
  }

  if (!TOKEN_STORES.has(normalized.tokenStore)) {
    throw new DeploymentConfigError('invalid_token_store', 'invalid token store');
  }
  if (production && normalized.tokenStore === 'memory' && !normalized.allowSingleInstancePilot) {
    throw new DeploymentConfigError('memory_token_store_not_allowed',
        'memory token store is not allowed in production');
  }
  if (['redis', 'postgres'].includes(normalized.tokenStore) && !normalized.tokenStoreUrl) {
    throw new DeploymentConfigError('missing_token_store_url',
        'missing token store URL');
  }

  if (!AUDIT_MODES.has(normalized.auditLogMode)) {
    throw new DeploymentConfigError('invalid_audit_log_mode', 'invalid audit log mode');
  }
  if (production && normalized.auditLogMode === 'disabled') {
    throw new DeploymentConfigError('audit_log_disabled',
        'audit logging may not be disabled in production');
  }
  if (normalized.auditLogMode === 'file' && !normalized.auditLogPath) {
    throw new DeploymentConfigError('missing_audit_log_path',
        'missing audit log path');
  }

  if (!RATE_LIMIT_MODES.has(normalized.rateLimitMode)) {
    throw new DeploymentConfigError('invalid_rate_limit_mode', 'invalid rate limit mode');
  }
  if (production && normalized.rateLimitMode === 'disabled') {
    throw new DeploymentConfigError('rate_limit_disabled',
        'rate limiting may not be disabled in production');
  }

  if (production && !normalized.allowedRelayTargetsFile) {
    throw new DeploymentConfigError('missing_allowed_relay_targets_file',
        'missing relay target allowlist');
  }

  assertPositiveBounded(normalized.relayMaxAuthBytes, 'relayMaxAuthBytes', {
    min: 128,
    max: 65536,
  });
  assertPositiveBounded(normalized.relayUnauthTimeoutMs, 'relayUnauthTimeoutMs', {
    min: 100,
    max: 60000,
  });
  assertPositiveBounded(normalized.relayIdleTimeoutMs, 'relayIdleTimeoutMs', {
    min: 1000,
    max: 30 * 60 * 1000,
  });
  assertPositiveBounded(normalized.relayAbsoluteTimeoutMs, 'relayAbsoluteTimeoutMs', {
    min: 1000,
    max: 8 * 60 * 60 * 1000,
  });
  assertPositiveBounded(normalized.jobReportMaxBytes, 'jobReportMaxBytes', {
    min: 128,
    max: 65536,
  });

  return normalized;
}

export function getSafeDeploymentSummary(config) {
  const validated = validateDeploymentConfig(config);
  return {
    env: validated.env,
    apiOrigin: new URL(validated.apiBaseUrl).origin,
    relayOrigin: new URL(validated.relayPublicUrl).origin,
    allowedWebOrigins: [...validated.allowedWebOrigins],
    tokenStore: validated.tokenStore,
    auditLogMode: validated.auditLogMode,
    rateLimitMode: validated.rateLimitMode,
    relayMaxAuthBytes: validated.relayMaxAuthBytes,
    relayUnauthTimeoutMs: validated.relayUnauthTimeoutMs,
    relayIdleTimeoutMs: validated.relayIdleTimeoutMs,
    relayAbsoluteTimeoutMs: validated.relayAbsoluteTimeoutMs,
    jobReportMaxBytes: validated.jobReportMaxBytes,
    hasAllowedRelayTargetsFile: Boolean(validated.allowedRelayTargetsFile),
    hasPolicyTrustRootsFile: Boolean(validated.policyTrustRootsFile),
    hasSignedPolicyFile: Boolean(validated.signedPolicyFile),
  };
}
