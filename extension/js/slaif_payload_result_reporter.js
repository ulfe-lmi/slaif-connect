import {
  policyAllowsApiBaseUrl,
  validateAlias,
  validateSessionId,
} from './slaif_policy.js';
import {validateOpaqueToken} from './slaif_session_descriptor.js';
import {validateJobReportTokenExpiresAt} from './slaif_job_reporter.js';
import {validatePayloadResult} from './payload_result_parser.js';

const FORBIDDEN_REPORT_FIELDS = new Set([
  'stdout',
  'stderr',
  'transcript',
  'rawOutput',
  'password',
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
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
]);

function assertNoForbiddenReportFields(value, path = '') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenReportFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_FIELDS.has(key)) {
      throw new Error(`payload result report must not include ${path}${key}`);
    }
    if (nested && typeof nested === 'object') {
      assertNoForbiddenReportFields(nested, `${path}${key}.`);
    }
  }
}

export function buildPayloadResultEndpoint(apiBaseUrl, sessionId, policy, {allowLocalDev = false} = {}) {
  validateSessionId(sessionId);
  policyAllowsApiBaseUrl(policy, apiBaseUrl, {allowLocalDev});
  const base = new URL(apiBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/api/connect/session/${encodeURIComponent(sessionId)}/payload-result`;
  base.search = '';
  base.hash = '';
  return base.href;
}

export function buildPayloadResultReportPayload({
  sessionId,
  hpc,
  payloadResult,
  reportedAt = new Date().toISOString(),
}) {
  const safeSessionId = validateSessionId(sessionId);
  const safeHpc = validateAlias(hpc);
  const result = validatePayloadResult(payloadResult);
  if (result.sessionId !== safeSessionId) {
    throw new Error('payload result sessionId does not match session');
  }
  if (result.hpc.toLowerCase() !== safeHpc) {
    throw new Error('payload result hpc does not match session');
  }
  if (!Number.isFinite(Date.parse(reportedAt))) {
    throw new Error('invalid reportedAt timestamp');
  }
  const payload = {
    ...result,
    hpc: safeHpc,
    reportedAt: new Date(Date.parse(reportedAt)).toISOString(),
  };
  assertNoForbiddenReportFields(payload);
  return payload;
}

export async function postPayloadResult({
  apiBaseUrl,
  sessionId,
  hpc,
  jobReportToken,
  jobReportTokenExpiresAt,
  policy,
  allowLocalDev = false,
  payloadResult,
  fetchImpl = globalThis.fetch,
}) {
  validateOpaqueToken(jobReportToken, 'jobReportToken');
  validateJobReportTokenExpiresAt(jobReportTokenExpiresAt);
  const endpoint = buildPayloadResultEndpoint(apiBaseUrl, sessionId, policy, {allowLocalDev});
  const payload = buildPayloadResultReportPayload({sessionId, hpc, payloadResult});
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${jobReportToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`payload result rejected by SLAIF API: ${response.status}`);
  }
  return payload;
}
