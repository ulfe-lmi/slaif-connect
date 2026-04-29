// SLAIF Connect policy helpers.
// This module keeps the old fork's allowlist idea but moves it out of nassh.

function defaultPolicyUrl() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL('config/hpc_hosts.example.json');
  }
  return new URL('../config/hpc_hosts.example.json', import.meta.url).href;
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

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('policy must be an object');
  }
  if (!policy.hosts || typeof policy.hosts !== 'object') {
    throw new Error('policy.hosts missing');
  }
  if (!policy.relay || typeof policy.relay.url !== 'string') {
    throw new Error('policy.relay.url missing');
  }

  const relayUrl = new URL(policy.relay.url);
  if (relayUrl.protocol !== 'wss:') {
    throw new Error('relay URL must use wss: in production');
  }

  for (const [alias, host] of Object.entries(policy.hosts)) {
    validateAlias(alias);
    validatePolicyHost(alias, host);
  }
}

export function validatePolicyHost(alias, host) {
  if (!host || typeof host !== 'object') {
    throw new Error(`policy host ${alias} must be an object`);
  }
  if (typeof host.sshHost !== 'string') {
    throw new Error(`policy host ${alias} missing sshHost`);
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
  if (host.knownHosts.every((line) => line.trim().startsWith('#'))) {
    console.warn(`policy host ${alias} contains placeholder known_hosts entries only`);
  }
  if (typeof host.remoteCommandTemplate !== 'string' || !host.remoteCommandTemplate.includes('${SESSION_ID}')) {
    throw new Error(`policy host ${alias} missing remoteCommandTemplate with \\${SESSION_ID}`);
  }
  validateRemoteCommandTemplate(host.remoteCommandTemplate, alias);

  // Normalize as a smoke check.
  normalizeHostLike(host.sshHost);
}

export function validateRemoteCommandTemplate(template, alias = 'host') {
  if (typeof template !== 'string' || !template.trim()) {
    throw new Error(`policy host ${alias} has empty remoteCommandTemplate`);
  }
  if (!template.includes('${SESSION_ID}')) {
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
