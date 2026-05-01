import {TOKEN_SCOPES, TokenRegistryError} from '../tokens/token_registry.js';
import {validatePayloadId} from './workload_protocol.js';

const DEFAULT_WORKLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^sess_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new TokenRegistryError('invalid_sessionId', 'invalid sessionId');
  }
  return sessionId;
}

function validateHpc(hpc) {
  if (typeof hpc !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(hpc)) {
    throw new TokenRegistryError('invalid_hpc', 'invalid hpc');
  }
  return hpc.toLowerCase();
}

function validateJobId(jobId, {required = false} = {}) {
  if (jobId === undefined || jobId === null || jobId === '') {
    if (required) {
      throw new TokenRegistryError('missing_jobId', 'missing jobId');
    }
    return undefined;
  }
  if (typeof jobId !== 'string' || !/^[0-9]{1,32}$/.test(jobId)) {
    throw new TokenRegistryError('invalid_jobId', 'invalid jobId');
  }
  return jobId;
}

function expectedBinding({
  sessionId,
  hpc,
  payloadId,
  jobId,
}) {
  const metadata = {payloadId: validatePayloadId(payloadId)};
  const safeJobId = validateJobId(jobId);
  if (safeJobId !== undefined) {
    metadata.jobId = safeJobId;
  }
  return {
    scope: TOKEN_SCOPES.WORKLOAD,
    sessionId: validateSessionId(sessionId),
    hpc: validateHpc(hpc),
    metadata,
  };
}

function assertJobBindingSatisfied(record, expected) {
  const boundJobId = record?.metadata?.jobId;
  if (boundJobId !== undefined && expected.jobId !== boundJobId) {
    throw new TokenRegistryError('wrong_jobId', 'wrong token jobId');
  }
}

export async function issueWorkloadToken(tokenStore, {
  sessionId,
  hpc,
  payloadId,
  jobId,
  ttlMs = DEFAULT_WORKLOAD_TOKEN_TTL_MS,
  maxUses = 1,
  metadata = {},
  ...rest
}) {
  const safePayloadId = validatePayloadId(payloadId);
  const safeJobId = validateJobId(jobId);
  return tokenStore.issueToken({
    ...rest,
    scope: TOKEN_SCOPES.WORKLOAD,
    sessionId: validateSessionId(sessionId),
    hpc: validateHpc(hpc),
    ttlMs,
    maxUses,
    metadata: {
      ...metadata,
      payloadId: safePayloadId,
      ...(safeJobId === undefined ? {} : {jobId: safeJobId}),
    },
  });
}

export async function validateWorkloadToken(tokenStore, token, expected) {
  const binding = expectedBinding(expected);
  const record = await tokenStore.validateToken(token, binding);
  assertJobBindingSatisfied(record, expected);
  return record;
}

export async function consumeWorkloadToken(tokenStore, token, expected) {
  const preflight = await validateWorkloadToken(tokenStore, token, expected);
  const binding = expectedBinding({
    ...expected,
    jobId: preflight.metadata?.jobId ?? expected.jobId,
  });
  return tokenStore.consumeToken(token, binding);
}

export function getSafeWorkloadTokenFingerprint(tokenStore, token) {
  return tokenStore.getSafeTokenFingerprint(token);
}
