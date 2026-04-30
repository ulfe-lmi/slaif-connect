// SLAIF Connect policy helpers.
// This module keeps the old fork's allowlist idea but moves it out of nassh.
import {
  evaluatePolicyRollback,
  policyFingerprint,
  verifySignedPolicyEnvelope,
} from './slaif_policy_signature.js';

function defaultPolicyUrl() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL('config/hpc_hosts.example.json');
  }
  return new URL('../config/hpc_hosts.example.json', import.meta.url).href;
}

function defaultSignedPolicyUrl() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL('config/hpc_policy.signed.example.json');
  }
  return new URL('../config/hpc_policy.signed.example.json', import.meta.url).href;
}

function defaultTrustRootsUrl() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL('config/policy_trust_roots.example.json');
  }
  return new URL('../config/policy_trust_roots.example.json', import.meta.url).href;
}

export function normalizeHostLike(value) {
  if (typeof value !== 'string') {
    throw new TypeError('host must be a string');
  }

  let host = value.trim();
  if (!host) {
    throw new Error('empty host');
  }

  // Trim a single trailing root dot.
  host = host.replace(/\.$/, '');

  // Browser URL canonicalization converts IDNs to ASCII/punycode for hostname.
  // It also lowercases hostnames. For raw IPv6 without brackets, fall back.
  try {
    if (host.includes(':') && !host.startsWith('[')) {
      return host.toLowerCase();
    }
    return new URL(`ssh://${host}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch (_e) {
    return host.toLowerCase();
  }
}

export function validateAlias(alias) {
  if (typeof alias !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(alias)) {
    throw new Error(`invalid HPC alias: ${alias}`);
  }
  return alias.toLowerCase();
}

export function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^sess_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new Error(`invalid SLAIF session id: ${sessionId}`);
  }
  return sessionId;
}

export async function loadHpcPolicy(url = defaultPolicyUrl()) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load HPC policy: ${response.status}`);
  }
  const policy = await response.json();
  validatePolicy(policy);
  return policy;
}

export async function loadVerifiedHpcPolicy({
  policyUrl = defaultSignedPolicyUrl(),
  trustRootsUrl = defaultTrustRootsUrl(),
  allowLocalDev = false,
  now = new Date(),
} = {}) {
  const [policyResponse, trustRootsResponse] = await Promise.all([
    fetch(policyUrl, {cache: 'no-store'}),
    fetch(trustRootsUrl, {cache: 'no-store'}),
  ]);
  if (!policyResponse.ok) {
    throw new Error(`failed to load signed HPC policy: ${policyResponse.status}`);
  }
  if (!trustRootsResponse.ok) {
    throw new Error(`failed to load policy trust roots: ${trustRootsResponse.status}`);
  }
  const envelope = await policyResponse.json();
  const trustRoots = await trustRootsResponse.json();
  const policy = await verifySignedPolicyEnvelope(envelope, trustRoots);
  validatePolicy(policy, {allowLocalDev, now});
  return {
    envelope,
    policy,
    fingerprint: await policyFingerprint(envelope),
  };
}

export function buildDevelopmentPolicy(runtimeConfig) {
  validateDevelopmentRuntimeConfig(runtimeConfig);
  return {
    type: 'slaif.hpcPolicy',
    version: 1,
    policyId: 'slaif-hpc-policy-local-dev',
    sequence: 1,
    validFrom: new Date(Date.now() - 60000).toISOString(),
    validUntil: new Date(Date.now() + 10 * 60000).toISOString(),
    development: true,
    allowedApiOrigins: [runtimeConfig.apiBaseUrl ?
      new URL(runtimeConfig.apiBaseUrl).origin :
      'http://127.0.0.1'],
    allowedRelayOrigins: [new URL(runtimeConfig.relayUrl).origin],
    hosts: {
      [runtimeConfig.hpc]: {
        displayName: 'Local test sshd',
        sshHost: runtimeConfig.sshHost || '127.0.0.1',
        sshPort: runtimeConfig.sshPort || 22,
        hostKeyAlias: runtimeConfig.hostKeyAlias || runtimeConfig.hpc,
        knownHosts: runtimeConfig.knownHosts,
        remoteCommandTemplate: runtimeConfig.remoteCommandTemplate ||
            'SESSION_ID=${SESSION_ID} /bin/printf slaif-browser-relay-ok',
        allowInteractiveTerminal: false,
        developmentOnly: true,
      },
    },
  };
}

export function validatePolicy(policy, {allowLocalDev = false, now = new Date()} = {}) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('policy must be an object');
  }
  if (policy.type === 'slaif.hpcPolicy') {
    validateSignedPolicyPayload(policy, {allowLocalDev: allowLocalDev || policy.development === true, now});
    return;
  }
  if (!policy.hosts || typeof policy.hosts !== 'object') {
    throw new Error('policy.hosts missing');
  }
  if (!policy.relay || typeof policy.relay.url !== 'string') {
    throw new Error('policy.relay.url missing');
  }

  const relayUrl = new URL(policy.relay.url);
  if (relayUrl.protocol !== 'wss:' &&
      !(policy.development === true &&
        relayUrl.protocol === 'ws:' &&
        ['127.0.0.1', 'localhost'].includes(relayUrl.hostname))) {
    throw new Error('relay URL must use wss: in production');
  }

  for (const [alias, host] of Object.entries(policy.hosts)) {
    validateAlias(alias);
    validatePolicyHost(alias, host);
  }
}

function parseTimestamp(value, name) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${name} must be a valid timestamp`);
  }
  return ms;
}

function assertOrigin(value, name, {secureProtocol, localDevProtocol, allowLocalDev}) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  const parsed = new URL(value);
  if (parsed.href !== parsed.origin + '/' && parsed.pathname !== '/' ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${name} must be an origin`);
  }
  if (parsed.protocol === secureProtocol) {
    return parsed.origin;
  }
  if (allowLocalDev && parsed.protocol === localDevProtocol &&
      parsed.hostname === '127.0.0.1') {
    return parsed.origin;
  }
  throw new Error(`${name} must use ${secureProtocol} outside local development`);
}

export function validateSignedPolicyPayload(policy, {allowLocalDev = false, now = new Date()} = {}) {
  if (policy.type !== 'slaif.hpcPolicy') {
    throw new Error('policy type must be slaif.hpcPolicy');
  }
  if (policy.version !== 1) {
    throw new Error('unsupported HPC policy version');
  }
  if (typeof policy.policyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(policy.policyId)) {
    throw new Error('policyId is invalid');
  }
  if (!Number.isSafeInteger(policy.sequence) || policy.sequence <= 0) {
    throw new Error('policy sequence must be a positive integer');
  }

  const validFromMs = parseTimestamp(policy.validFrom, 'validFrom');
  const validUntilMs = parseTimestamp(policy.validUntil, 'validUntil');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error('policy validation clock is invalid');
  }
  if (validUntilMs <= validFromMs) {
    throw new Error('policy validUntil must be after validFrom');
  }
  if (nowMs < validFromMs) {
    throw new Error('signed HPC policy is not yet valid');
  }
  if (nowMs >= validUntilMs) {
    throw new Error('signed HPC policy has expired');
  }

  if (!Array.isArray(policy.allowedApiOrigins) || policy.allowedApiOrigins.length === 0) {
    throw new Error('policy allowedApiOrigins missing');
  }
  if (!Array.isArray(policy.allowedRelayOrigins) || policy.allowedRelayOrigins.length === 0) {
    throw new Error('policy allowedRelayOrigins missing');
  }
  for (const origin of policy.allowedApiOrigins) {
    assertOrigin(origin, 'allowedApiOrigins entry', {
      secureProtocol: 'https:',
      localDevProtocol: 'http:',
      allowLocalDev,
    });
  }
  for (const origin of policy.allowedRelayOrigins) {
    assertOrigin(origin, 'allowedRelayOrigins entry', {
      secureProtocol: 'wss:',
      localDevProtocol: 'ws:',
      allowLocalDev,
    });
  }
  if (!policy.hosts || typeof policy.hosts !== 'object' || Array.isArray(policy.hosts) ||
      Object.keys(policy.hosts).length === 0) {
    throw new Error('policy.hosts missing');
  }

  for (const [alias, host] of Object.entries(policy.hosts)) {
    validateAlias(alias);
    validatePolicyHost(alias, host, {
      allowPilotFixedCommand: allowLocalDev && policy.pilot === true,
    });
  }
}

export function validatePolicyHost(alias, host, {allowPilotFixedCommand = false} = {}) {
  if (!host || typeof host !== 'object') {
    throw new Error(`policy host ${alias} must be an object`);
  }
  for (const forbidden of [
    'commandFromDescriptor',
    'allowArbitraryCommand',
    'disableHostKeyChecking',
    'disableStrictHostKeyChecking',
    'StrictHostKeyChecking',
    'strictHostKeyChecking',
    'sshOptions',
    'commandFromWeb',
  ]) {
    if (Object.hasOwn(host, forbidden)) {
      throw new Error(`policy host ${alias} contains forbidden field ${forbidden}`);
    }
  }
  if (typeof host.sshHost !== 'string') {
    throw new Error(`policy host ${alias} missing sshHost`);
  }
  if (host.sshHost.includes('://') || /[/?#@]/.test(host.sshHost)) {
    throw new Error(`policy host ${alias} sshHost must be a hostname, not a URL`);
  }
  if (!Number.isInteger(host.sshPort) || host.sshPort <= 0 || host.sshPort > 65535) {
    throw new Error(`policy host ${alias} has invalid sshPort`);
  }
  if (typeof host.hostKeyAlias !== 'string' || validateAlias(host.hostKeyAlias) !== alias) {
    throw new Error(`policy host ${alias} must use hostKeyAlias equal to the alias`);
  }
  if (!Array.isArray(host.knownHosts) || host.knownHosts.length === 0) {
    throw new Error(`policy host ${alias} must include knownHosts entries`);
  }
  if (host.knownHosts.some((line) => typeof line !== 'string')) {
    throw new Error(`policy host ${alias} knownHosts entries must be strings`);
  }
  for (const line of host.knownHosts) {
    if (line.trim() && !line.trim().startsWith('#')) {
      validateKnownHostsLine(line, alias);
    }
  }
  if (host.knownHosts.every((line) => line.trim().startsWith('#'))) {
    console.warn(`policy host ${alias} contains placeholder known_hosts entries only`);
  }
  if (typeof host.remoteCommandTemplate !== 'string') {
    throw new Error(`policy host ${alias} missing remoteCommandTemplate`);
  }
  const pilotFixedCommand = allowPilotFixedCommand &&
      host.pilotFixedCommand === true &&
      host.developmentOnly === true;
  if (!pilotFixedCommand && !host.remoteCommandTemplate.includes('${SESSION_ID}')) {
    throw new Error(`policy host ${alias} missing remoteCommandTemplate with \\${SESSION_ID}`);
  }
  validateRemoteCommandTemplate(host.remoteCommandTemplate, alias, {allowPilotFixedCommand: pilotFixedCommand});

  // Normalize as a smoke check.
  normalizeHostLike(host.sshHost);
}

export function validateKnownHostsLine(line, alias = 'host') {
  if (typeof line !== 'string') {
    throw new Error(`policy host ${alias} known_hosts entry must be a string`);
  }
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return trimmed;
  }
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error(`policy host ${alias} known_hosts entry contains control characters`);
  }
  const parts = trimmed.split(/\s+/);
  const keyIndex = parts[0].startsWith('@') ? 2 : 1;
  if (parts.length <= keyIndex + 1) {
    throw new Error(`policy host ${alias} known_hosts entry is incomplete`);
  }
  const hosts = parts[0].startsWith('@') ? parts[1] : parts[0];
  const keyType = parts[keyIndex];
  const keyBody = parts[keyIndex + 1];
  if (!hosts.split(',').some((host) => host === alias)) {
    throw new Error(`policy host ${alias} known_hosts entry must include alias`);
  }
  if (!/^ssh-(ed25519|rsa)|^ecdsa-sha2-nistp(256|384|521)$/.test(keyType)) {
    throw new Error(`policy host ${alias} known_hosts entry has unsupported key type`);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(keyBody)) {
    throw new Error(`policy host ${alias} known_hosts entry has invalid key data`);
  }
  return trimmed;
}

export function validateRemoteCommandTemplate(template, alias = 'host', {allowPilotFixedCommand = false} = {}) {
  if (typeof template !== 'string' || !template.trim()) {
    throw new Error(`policy host ${alias} has empty remoteCommandTemplate`);
  }
  if (!allowPilotFixedCommand && !template.includes('${SESSION_ID}')) {
    throw new Error(`policy host ${alias} command template must include \\${SESSION_ID}`);
  }
  if (/\$\{(?!SESSION_ID\})/.test(template)) {
    throw new Error(`policy host ${alias} command template contains unsupported placeholders`);
  }
  if (/[\r\n\0]/.test(template)) {
    throw new Error(`policy host ${alias} command template contains control characters`);
  }
}

export function requireKnownHpcAlias(policy, alias) {
  const safeAlias = validateAlias(alias);
  const host = policy.hosts[safeAlias];
  if (!host) {
    throw new Error(`unknown or disallowed HPC alias: ${alias}`);
  }
  return host;
}

export function policyAllowsApiBaseUrl(policy, apiBaseUrl, {allowLocalDev = false} = {}) {
  const base = new URL(apiBaseUrl);
  const origin = base.origin;
  if (policy.type === 'slaif.hpcPolicy') {
    if (!policy.allowedApiOrigins.includes(origin)) {
      throw new Error('SLAIF API origin is not allowed by signed HPC policy');
    }
    assertOrigin(origin, 'apiBaseUrl origin', {
      secureProtocol: 'https:',
      localDevProtocol: 'http:',
      allowLocalDev,
    });
    return origin;
  }
  if (allowLocalDev && base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)) {
    return origin;
  }
  if (base.protocol === 'https:') {
    return origin;
  }
  throw new Error('SLAIF API origin is not allowed');
}

export function policyAllowsRelayUrl(policy, relayUrl, {allowLocalDev = false} = {}) {
  const relay = new URL(relayUrl);
  const origin = relay.origin;
  if (policy.type === 'slaif.hpcPolicy') {
    if (!policy.allowedRelayOrigins.includes(origin)) {
      throw new Error('relay origin is not allowed by signed HPC policy');
    }
    assertOrigin(origin, 'relayUrl origin', {
      secureProtocol: 'wss:',
      localDevProtocol: 'ws:',
      allowLocalDev,
    });
    return origin;
  }
  if (policy.relay?.url && new URL(policy.relay.url).origin === origin) {
    return origin;
  }
  throw new Error('relay origin is not allowed');
}

export function evaluateAcceptedPolicyRollback(policyRecord, previousRecord) {
  evaluatePolicyRollback(policyRecord, previousRecord);
}

export function buildRemoteCommand(policyHost, sessionId) {
  validateSessionId(sessionId);

  // The command template is controlled by extension policy. The server provides
  // only the session id. Because the session id is strictly validated, it is safe
  // to substitute directly into the template.
  return policyHost.remoteCommandTemplate.replaceAll('${SESSION_ID}', sessionId);
}

export function buildKnownHostsText(policyHost) {
  return policyHost.knownHosts
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .join('\n') + '\n';
}

export function requireLaunchableKnownHosts(policyHost) {
  const knownHosts = buildKnownHostsText(policyHost).trim();
  if (!knownHosts) {
    throw new Error('SSH launch requires at least one non-placeholder known_hosts entry');
  }
  return `${knownHosts}\n`;
}

export function validateDevelopmentRuntimeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('development runtime config must be an object');
  }
  if (config.mode !== 'local-dev') {
    throw new Error('development runtime config mode must be local-dev');
  }
  validateAlias(config.hpc);
  validateSessionId(config.sessionId);
  if (typeof config.relayUrl !== 'string') {
    throw new Error('development runtime config missing relayUrl');
  }
  const relayUrl = new URL(config.relayUrl);
  if (relayUrl.protocol !== 'ws:' ||
      !['127.0.0.1', 'localhost'].includes(relayUrl.hostname)) {
    throw new Error('development relayUrl must be ws://127.0.0.1 or ws://localhost');
  }
  if (typeof config.relayToken !== 'string' || config.relayToken.length < 8) {
    throw new Error('development runtime config missing relayToken');
  }
  if (config.apiBaseUrl !== undefined) {
    const apiBaseUrl = new URL(config.apiBaseUrl);
    if (apiBaseUrl.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(apiBaseUrl.hostname)) {
      throw new Error('development apiBaseUrl must be http://127.0.0.1 or http://localhost');
    }
  }
  if (config.launchToken !== undefined &&
      (typeof config.launchToken !== 'string' || config.launchToken.length < 16)) {
    throw new Error('development runtime config has invalid launchToken');
  }
  if (typeof config.username !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(config.username)) {
    throw new Error('development runtime config has invalid username');
  }
  if (!Array.isArray(config.knownHosts) || config.knownHosts.length === 0) {
    throw new Error('development runtime config missing knownHosts');
  }
  const alias = config.hostKeyAlias || config.hpc;
  validateAlias(alias);
  for (const line of config.knownHosts) {
    validateKnownHostsLine(line, alias);
  }
  if (config.sshPort !== undefined &&
      (!Number.isInteger(config.sshPort) || config.sshPort <= 0 || config.sshPort > 65535)) {
    throw new Error('development runtime config has invalid sshPort');
  }
  return config;
}
