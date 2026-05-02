import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePayloadId} from './payload_catalog.js';

export const SLURM_PROFILE_CATALOG_TYPE = 'slaif.slurmProfileCatalog';
export const SLURM_PROFILE_CATALOG_VERSION = 1;

export const ALLOWED_SLURM_TEMPLATE_IDS = Object.freeze([
  'cpu_memory_diagnostics_v1',
  'gpu_diagnostics_v1',
  'gams_chat_v1_scaffold',
]);

const FORBIDDEN_SLURM_PROFILE_FIELDS = new Set([
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
  'password',
  'passphrase',
  'otp',
  'privateKey',
  'sshPrivateKey',
  'launchToken',
  'relayToken',
  'jobReportToken',
  'workloadToken',
  'token',
  'Authorization',
  'authorization',
]);

const SAFE_ID_RE = /^[A-Za-z0-9_.-]{1,96}$/;
const SAFE_RESOURCE_RE = /^[A-Za-z0-9_@%+=:.,/-]{0,128}$/;
const TIME_LIMIT_RE = /^(?:[0-9]{1,2}-)?[0-9]{1,2}:[0-5][0-9]:[0-5][0-9]$/;
const MEMORY_RE = /^[1-9][0-9]{0,5}(?:K|M|G|T)$/i;

export class SlurmProfileError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SlurmProfileError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new SlurmProfileError('invalid_object', `${name} must be an object`);
  }
}

function assertSafeOptionalString(value, name) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string' || !SAFE_RESOURCE_RE.test(value)) {
    throw new SlurmProfileError(`invalid_${name}`, `${name} is unsafe`);
  }
  return value;
}

function assertPositiveInteger(value, name, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new SlurmProfileError(`invalid_${name}`, `${name} is invalid`);
  }
  return value;
}

function validateProfilePayloadId(payloadId) {
  try {
    return validatePayloadId(payloadId);
  } catch {
    throw new SlurmProfileError('invalid_payload_id', 'invalid payloadId');
  }
}

export function assertNoForbiddenSlurmProfileFields(value, pathPrefix = '') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenSlurmProfileFields(entry, `${pathPrefix}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SLURM_PROFILE_FIELDS.has(key)) {
      throw new SlurmProfileError(
          'forbidden_slurm_profile_field',
          `Slurm profile must not include ${pathPrefix}${key}`,
      );
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenSlurmProfileFields(nested, `${pathPrefix}${key}.`);
    }
  }
}

export function validateSlurmProfile(profile) {
  assertPlainObject(profile, 'Slurm profile');
  assertNoForbiddenSlurmProfileFields(profile);
  if (typeof profile.profileId !== 'string' || !SAFE_ID_RE.test(profile.profileId)) {
    throw new SlurmProfileError('invalid_profile_id', 'invalid profileId');
  }
  const payloadId = validateProfilePayloadId(profile.payloadId);
  if (profile.scheduler !== 'slurm') {
    throw new SlurmProfileError('invalid_scheduler', 'scheduler must be slurm');
  }
  if (typeof profile.jobName !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(profile.jobName)) {
    throw new SlurmProfileError('invalid_job_name', 'invalid jobName');
  }
  if (typeof profile.timeLimit !== 'string' || !TIME_LIMIT_RE.test(profile.timeLimit)) {
    throw new SlurmProfileError('invalid_time_limit', 'invalid timeLimit');
  }
  if (typeof profile.memory !== 'string' || !MEMORY_RE.test(profile.memory)) {
    throw new SlurmProfileError('invalid_memory', 'invalid memory');
  }
  const cpusPerTask = assertPositiveInteger(profile.cpusPerTask, 'cpusPerTask', 256);
  const gpus = profile.gpus === undefined || profile.gpus === null || profile.gpus === '' ?
    undefined :
    assertPositiveInteger(profile.gpus, 'gpus', 64);
  const template = profile.template === 'gams_chat_v1_scaffold' ?
    profile.template :
    validateProfilePayloadId(profile.template);
  if (!ALLOWED_SLURM_TEMPLATE_IDS.includes(template)) {
    throw new SlurmProfileError('invalid_template', 'invalid template');
  }
  if (payloadId === 'gams_chat_v1' && template !== 'gams_chat_v1_scaffold') {
    throw new SlurmProfileError('invalid_template', 'gams_chat_v1 must use scaffold template in this PR');
  }
  return {
    profileId: profile.profileId,
    payloadId,
    scheduler: 'slurm',
    jobName: profile.jobName,
    timeLimit: profile.timeLimit,
    cpusPerTask,
    memory: profile.memory.toUpperCase(),
    partition: assertSafeOptionalString(profile.partition, 'partition'),
    account: assertSafeOptionalString(profile.account, 'account'),
    qos: assertSafeOptionalString(profile.qos, 'qos'),
    gres: assertSafeOptionalString(profile.gres, 'gres'),
    gpus,
    maxOutputBytes: assertPositiveInteger(profile.maxOutputBytes, 'maxOutputBytes', 1048576),
    template,
  };
}

export function validateSlurmProfileCatalog(profileCatalog) {
  assertPlainObject(profileCatalog, 'Slurm profile catalog');
  assertNoForbiddenSlurmProfileFields(profileCatalog);
  if (profileCatalog.type !== SLURM_PROFILE_CATALOG_TYPE) {
    throw new SlurmProfileError('invalid_type', 'invalid Slurm profile catalog type');
  }
  if (profileCatalog.version !== SLURM_PROFILE_CATALOG_VERSION) {
    throw new SlurmProfileError('invalid_version', 'invalid Slurm profile catalog version');
  }
  assertPlainObject(profileCatalog.profiles, 'profiles');
  const profiles = {};
  for (const [profileKey, profile] of Object.entries(profileCatalog.profiles)) {
    const normalized = validateSlurmProfile(profile);
    if (profileKey !== normalized.payloadId && profileKey !== normalized.profileId) {
      throw new SlurmProfileError('invalid_profile_key', 'profile key must match payloadId or profileId');
    }
    profiles[profileKey] = normalized;
  }
  return {
    type: SLURM_PROFILE_CATALOG_TYPE,
    version: SLURM_PROFILE_CATALOG_VERSION,
    profiles,
  };
}

export function resolveSlurmProfile(profileCatalog, payloadId) {
  const safePayloadId = validateProfilePayloadId(payloadId);
  const catalog = validateSlurmProfileCatalog(profileCatalog);
  const direct = catalog.profiles[safePayloadId];
  if (direct) {
    return direct;
  }
  const match = Object.values(catalog.profiles).find((profile) => profile.payloadId === safePayloadId);
  if (!match) {
    throw new SlurmProfileError('missing_profile', 'missing Slurm profile for payloadId');
  }
  return match;
}

export function buildSbatchArgs(profile, scriptPath) {
  const validated = validateSlurmProfile(profile);
  if (typeof scriptPath !== 'string' || !path.isAbsolute(scriptPath)) {
    throw new SlurmProfileError('invalid_script_path', 'scriptPath must be absolute');
  }
  const args = [
    '--job-name', validated.jobName,
    '--time', validated.timeLimit,
    '--cpus-per-task', String(validated.cpusPerTask),
    '--mem', validated.memory,
    '--output', `${scriptPath}.out`,
    '--error', `${scriptPath}.err`,
  ];
  if (validated.account) {
    args.push('--account', validated.account);
  }
  if (validated.partition) {
    args.push('--partition', validated.partition);
  }
  if (validated.qos) {
    args.push('--qos', validated.qos);
  }
  if (validated.gres) {
    args.push('--gres', validated.gres);
  }
  if (validated.gpus !== undefined) {
    args.push('--gpus', String(validated.gpus));
  }
  args.push(scriptPath);
  return args;
}

export function buildSbatchScriptFromTemplate(templateId, context = {}, options = {}) {
  if (!ALLOWED_SLURM_TEMPLATE_IDS.includes(templateId)) {
    throw new SlurmProfileError('invalid_template', 'invalid template');
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = options.templateDir ||
      path.resolve(__dirname, '../../remote/launcher/templates');
  const templatePath = path.join(templateDir, `${templateId}.sh`);
  const template = fs.readFileSync(templatePath, 'utf8');
  const sessionId = context.sessionId || '';
  if (sessionId && !/^sess_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new SlurmProfileError('invalid_session_id', 'invalid sessionId');
  }
  return `#!/bin/sh
set -eu
export SLAIF_SESSION_ID=${JSON.stringify(sessionId)}
export SLAIF_HPC_ALIAS=${JSON.stringify(context.hpc || context.hpcAlias || '')}
export SLAIF_PAYLOAD_ID=${JSON.stringify(context.payloadId || '')}
export SLAIF_WORK_DIR=${JSON.stringify(context.workDir || '')}

${template}
`;
}
