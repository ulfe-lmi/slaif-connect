import {
  policyAllowsRelayUrl,
  validateAlias,
  validateSessionId,
} from './slaif_policy.js';

export const FORBIDDEN_SSH_TARGET_FIELDS = Object.freeze([
  'sshHost',
  'sshPort',
  'host',
  'port',
  'knownHosts',
  'known_hosts',
  'hostKey',
  'hostKeyAlias',
  'command',
  'remoteCommand',
  'sshOptions',
  'relayHost',
  'relayPort',
  'jobCommand',
  'schedulerCommand',
  'stdoutUploadUrl',
  'transcriptUploadUrl',
  'reportUrl',
  'jobReportUrl',
]);

const LOCAL_DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function rejectForbiddenFields(value, context) {
  for (const field of FORBIDDEN_SSH_TARGET_FIELDS) {
    if (Object.hasOwn(value, field)) {
      throw new Error(`${context} must not include ${field}`);
    }
  }
}

export function validateOpaqueToken(value, name) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 2048) {
    throw new Error(`${name} must be an opaque token`);
  }
  if (/[\s"'<>`\\\0]/.test(value)) {
    throw new Error(`${name} contains invalid characters`);
  }
  return value;
}

export function sanitizeUsernameHint(usernameHint) {
  if (usernameHint === undefined || usernameHint === null || usernameHint === '') {
    return undefined;
  }
  if (typeof usernameHint !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(usernameHint)) {
    throw new Error('invalid usernameHint');
  }
  return usernameHint;
}

export function validateLaunchMessage(message) {
  assertPlainObject(message, 'launch message');
  rejectForbiddenFields(message, 'launch message');

  if (message.type !== 'slaif.startSession') {
    throw new Error('unsupported launch message type');
  }
  if (message.version !== 1) {
    throw new Error('unsupported launch message version');
  }

  return {
    type: 'slaif.startSession',
    version: 1,
    hpc: validateAlias(message.hpc),
    sessionId: validateSessionId(message.sessionId),
    launchToken: validateOpaqueToken(message.launchToken, 'launchToken'),
  };
}

export function validateRelayUrl(relayUrl, {allowLocalDev = false} = {}) {
  if (typeof relayUrl !== 'string') {
    throw new Error('relayUrl must be a string');
  }
  const parsed = new URL(relayUrl);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('relayUrl must not include credentials or fragments');
  }
  if (parsed.protocol === 'wss:') {
    return parsed.href;
  }
  if (allowLocalDev && parsed.protocol === 'ws:' && LOCAL_DEV_HOSTS.has(parsed.hostname)) {
    return parsed.href;
  }
  throw new Error('relayUrl must use wss: outside local development');
}

export function validateSessionDescriptor(descriptor, pendingLaunch, policyHost, options = {}) {
  assertPlainObject(descriptor, 'session descriptor');
  assertPlainObject(pendingLaunch, 'pending launch');
  assertPlainObject(policyHost, 'policy host');
  rejectForbiddenFields(descriptor, 'session descriptor');

  if (descriptor.type !== 'slaif.sessionDescriptor') {
    throw new Error('unsupported session descriptor type');
  }
  if (descriptor.version !== 1) {
    throw new Error('unsupported session descriptor version');
  }

  const sessionId = validateSessionId(descriptor.sessionId);
  if (sessionId !== pendingLaunch.sessionId) {
    throw new Error('session descriptor sessionId mismatch');
  }

  const hpc = validateAlias(descriptor.hpc);
  if (hpc !== pendingLaunch.hpc) {
    throw new Error('session descriptor hpc mismatch');
  }

  const policyAlias = validateAlias(policyHost.hostKeyAlias);
  if (policyAlias !== hpc) {
    throw new Error('session descriptor does not match extension policy host');
  }

  const relayUrl = validateRelayUrl(descriptor.relayUrl, options);
  if (options.policy) {
    policyAllowsRelayUrl(options.policy, relayUrl, {allowLocalDev: Boolean(options.allowLocalDev)});
  }
  const relayToken = validateOpaqueToken(descriptor.relayToken, 'relayToken');

  let relayTokenExpiresAt;
  if (descriptor.relayTokenExpiresAt === undefined) {
    throw new Error('relayTokenExpiresAt is required');
  }
  if (typeof descriptor.relayTokenExpiresAt !== 'string') {
    throw new Error('relayTokenExpiresAt must be an ISO timestamp');
  }
  const relayExpiresAtMs = Date.parse(descriptor.relayTokenExpiresAt);
  if (!Number.isFinite(relayExpiresAtMs)) {
    throw new Error('relayTokenExpiresAt must be a valid timestamp');
  }
  if (relayExpiresAtMs <= Date.now()) {
    throw new Error('relayToken has expired');
  }
  relayTokenExpiresAt = new Date(relayExpiresAtMs).toISOString();

  const jobReportToken = validateOpaqueToken(descriptor.jobReportToken, 'jobReportToken');
  let jobReportTokenExpiresAt;
  if (descriptor.jobReportTokenExpiresAt === undefined) {
    throw new Error('jobReportTokenExpiresAt is required');
  }
  if (typeof descriptor.jobReportTokenExpiresAt !== 'string') {
    throw new Error('jobReportTokenExpiresAt must be an ISO timestamp');
  }
  const jobReportExpiresAtMs = Date.parse(descriptor.jobReportTokenExpiresAt);
  if (!Number.isFinite(jobReportExpiresAtMs)) {
    throw new Error('jobReportTokenExpiresAt must be a valid timestamp');
  }
  if (jobReportExpiresAtMs <= Date.now()) {
    throw new Error('jobReportToken has expired');
  }
  jobReportTokenExpiresAt = new Date(jobReportExpiresAtMs).toISOString();

  return {
    type: 'slaif.sessionDescriptor',
    version: 1,
    sessionId,
    hpc,
    relayUrl,
    relayToken,
    relayTokenExpiresAt,
    jobReportToken,
    jobReportTokenExpiresAt,
    usernameHint: sanitizeUsernameHint(descriptor.usernameHint),
    mode: descriptor.mode === undefined ? 'launch' : descriptor.mode,
  };
}

export function buildDescriptorFetchRequest(pendingLaunch, apiBaseUrl) {
  assertPlainObject(pendingLaunch, 'pending launch');
  validateSessionId(pendingLaunch.sessionId);
  validateOpaqueToken(pendingLaunch.launchToken, 'launchToken');

  if (typeof apiBaseUrl !== 'string') {
    throw new Error('apiBaseUrl must be a string');
  }
  const base = new URL(apiBaseUrl);
  if (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && LOCAL_DEV_HOSTS.has(base.hostname))) {
    throw new Error('apiBaseUrl must use https: outside local development');
  }
  base.pathname = `${base.pathname.replace(/\/$/, '')}/api/connect/session/${encodeURIComponent(pendingLaunch.sessionId)}`;
  base.search = '';
  base.hash = '';

  return {
    url: base.href,
    options: {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${pendingLaunch.launchToken}`,
      },
    },
  };
}
