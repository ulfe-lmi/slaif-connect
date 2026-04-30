import crypto from 'node:crypto';
import fs from 'node:fs';
import {validatePolicy} from '../../extension/js/slaif_policy.js';

export const PILOT_INPUT_TYPE = 'slaif.hpcPilotInput';

const FORBIDDEN_PILOT_FIELDS = [
  'password',
  'otp',
  'privateKey',
  'private_key',
  'passphrase',
  'sshOptions',
  'StrictHostKeyChecking',
  'strictHostKeyChecking',
  'commandFromWeb',
  'allowArbitraryCommand',
  'launchToken',
  'relayToken',
];

export function parseCliArgs(argv, {boolean = []} = {}) {
  const booleans = new Set(boolean);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    if (booleans.has(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }
    args[key] = value;
  }
  return args;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function fingerprintFromPublicKeyBody(keyBody) {
  if (typeof keyBody !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(keyBody)) {
    throw new Error('invalid OpenSSH public key body');
  }
  const digest = crypto.createHash('sha256').update(Buffer.from(keyBody, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

export function parseKnownHostsLine(line) {
  if (typeof line !== 'string') {
    throw new Error('known_hosts line must be a string');
  }
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error('known_hosts line contains control characters');
  }
  const parts = trimmed.split(/\s+/);
  const marker = parts[0].startsWith('@') ? parts[0] : null;
  const hostPattern = marker ? parts[1] : parts[0];
  const keyType = marker ? parts[2] : parts[1];
  const keyBody = marker ? parts[3] : parts[2];
  if (!hostPattern || !keyType || !keyBody) {
    throw new Error('known_hosts line is incomplete');
  }
  return {
    marker,
    hostPattern,
    keyType,
    keyBody,
    fingerprint: fingerprintFromPublicKeyBody(keyBody),
    line: trimmed,
  };
}

export function fingerprintsFromKnownHosts(text, {alias} = {}) {
  const entries = [];
  for (const line of String(text).split(/\n/)) {
    const parsed = parseKnownHostsLine(line);
    if (!parsed) {
      continue;
    }
    if (alias) {
      const hosts = parsed.hostPattern.split(',');
      if (!hosts.includes(alias)) {
        continue;
      }
    }
    entries.push(parsed);
  }
  return entries;
}

function assertNoForbiddenFields(input) {
  for (const field of FORBIDDEN_PILOT_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new Error(`pilot input contains forbidden field ${field}`);
    }
  }
}

function validateAlias(value, name = 'alias') {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(value)) {
    throw new Error(`invalid ${name}`);
  }
  return value.toLowerCase();
}

function validateTimestamp(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return value;
}

export function validatePilotInput(input, {pilotFixedCommand = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('pilot input must be an object');
  }
  assertNoForbiddenFields(input);
  if (input.type !== PILOT_INPUT_TYPE || input.version !== 1) {
    throw new Error('unsupported pilot input');
  }
  const alias = validateAlias(input.alias);
  if (validateAlias(input.hostKeyAlias, 'hostKeyAlias') !== alias) {
    throw new Error('pilot hostKeyAlias must match alias');
  }
  if (typeof input.displayName !== 'string' || !input.displayName.trim()) {
    throw new Error('pilot displayName is required');
  }
  if (typeof input.sshHost !== 'string' || !input.sshHost.trim() ||
      input.sshHost.includes('://') || /[/?#@]/.test(input.sshHost)) {
    throw new Error('pilot sshHost must be a hostname, not a URL');
  }
  if (!Number.isInteger(input.sshPort) || input.sshPort <= 0 || input.sshPort > 65535) {
    throw new Error('pilot sshPort is invalid');
  }
  if (!Array.isArray(input.verifiedKnownHosts) || input.verifiedKnownHosts.length === 0) {
    throw new Error('pilot verifiedKnownHosts must be non-empty');
  }
  for (const line of input.verifiedKnownHosts) {
    const parsed = parseKnownHostsLine(line);
    if (!parsed) {
      throw new Error('pilot verifiedKnownHosts must not contain blank entries');
    }
    if (!parsed.hostPattern.split(',').includes(alias)) {
      throw new Error('pilot verifiedKnownHosts entries must include the alias');
    }
  }
  if (!Array.isArray(input.allowedApiOrigins) || input.allowedApiOrigins.length === 0) {
    throw new Error('pilot allowedApiOrigins must be non-empty');
  }
  if (!Array.isArray(input.allowedRelayOrigins) || input.allowedRelayOrigins.length === 0) {
    throw new Error('pilot allowedRelayOrigins must be non-empty');
  }
  if (typeof input.remoteCommandTemplate !== 'string' || !input.remoteCommandTemplate.trim()) {
    throw new Error('pilot remoteCommandTemplate is required');
  }
  if (!input.remoteCommandTemplate.includes('${SESSION_ID}') && !pilotFixedCommand) {
    throw new Error('pilot remoteCommandTemplate must include ${SESSION_ID} unless --pilot-fixed-command is set');
  }
  return {
    ...input,
    alias,
    hostKeyAlias: alias,
  };
}

export function createPilotPolicyPayload(input, {
  policyId,
  sequence,
  validFrom,
  validUntil,
  pilotFixedCommand = false,
} = {}) {
  const pilot = validatePilotInput(input, {pilotFixedCommand});
  if (!policyId || typeof policyId !== 'string') {
    throw new Error('policyId is required');
  }
  const numericSequence = Number(sequence);
  if (!Number.isSafeInteger(numericSequence) || numericSequence <= 0) {
    throw new Error('sequence must be a positive integer');
  }
  const payload = {
    type: 'slaif.hpcPolicy',
    version: 1,
    policyId,
    sequence: numericSequence,
    validFrom: validateTimestamp(validFrom, 'validFrom'),
    validUntil: validateTimestamp(validUntil, 'validUntil'),
    pilot: true,
    allowedApiOrigins: pilot.allowedApiOrigins,
    allowedRelayOrigins: pilot.allowedRelayOrigins,
    hosts: {
      [pilot.alias]: {
        displayName: pilot.displayName,
        sshHost: pilot.sshHost,
        sshPort: pilot.sshPort,
        hostKeyAlias: pilot.hostKeyAlias,
        knownHosts: pilot.verifiedKnownHosts,
        remoteCommandTemplate: pilot.remoteCommandTemplate,
        pilotFixedCommand: pilotFixedCommand && !pilot.remoteCommandTemplate.includes('${SESSION_ID}'),
        developmentOnly: pilot.allowedApiOrigins.some((origin) => origin.startsWith('http://127.0.0.1')) ||
            pilot.allowedRelayOrigins.some((origin) => origin.startsWith('ws://127.0.0.1')),
      },
    },
  };
  validatePolicy(payload, {allowLocalDev: true, now: new Date(Date.parse(validFrom) + 1000)});
  return payload;
}
