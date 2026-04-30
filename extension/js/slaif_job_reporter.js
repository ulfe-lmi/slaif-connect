import {
  policyAllowsApiBaseUrl,
  validateAlias,
  validateSessionId,
} from './slaif_policy.js';
import {validateOpaqueToken} from './slaif_session_descriptor.js';

const VALID_STATUSES = new Set([
  'submitted',
  'job_id_not_found',
  'ssh_failed',
  'report_failed',
]);

const VALID_SCHEDULERS = new Set(['slurm']);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

export function validateSlurmJobId(jobId) {
  if (typeof jobId !== 'string' || !/^[0-9]{1,32}$/.test(jobId)) {
    throw new Error('invalid SLURM job ID');
  }
  return jobId;
}

export function validateJobReportTokenExpiresAt(value, now = new Date()) {
  if (typeof value !== 'string') {
    throw new Error('jobReportTokenExpiresAt must be an ISO timestamp');
  }
  const expiresAtMs = Date.parse(value);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('jobReportTokenExpiresAt must be a valid timestamp');
  }
  if (expiresAtMs <= nowMs) {
    throw new Error('jobReportToken has expired');
  }
  return new Date(expiresAtMs).toISOString();
}

export function buildJobReportEndpoint(apiBaseUrl, sessionId, policy, {allowLocalDev = false} = {}) {
  validateSessionId(sessionId);
  policyAllowsApiBaseUrl(policy, apiBaseUrl, {allowLocalDev});
  const base = new URL(apiBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/api/connect/session/${encodeURIComponent(sessionId)}/job-report`;
  base.search = '';
  base.hash = '';
  return base.href;
}

export function buildJobReportPayload({
  sessionId,
  hpc,
  scheduler,
  jobId,
  status,
  sshExitCode,
  reportedAt = new Date().toISOString(),
}) {
  const safeSessionId = validateSessionId(sessionId);
  const safeHpc = validateAlias(hpc);
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`invalid job report status: ${status}`);
  }
  if (scheduler !== undefined && !VALID_SCHEDULERS.has(scheduler)) {
    throw new Error(`invalid scheduler: ${scheduler}`);
  }
  if (status === 'submitted') {
    if (scheduler !== 'slurm') {
      throw new Error('submitted reports require scheduler slurm');
    }
    validateSlurmJobId(jobId);
  } else if (jobId !== undefined) {
    throw new Error('jobId is only allowed for submitted reports');
  }
  if (sshExitCode !== undefined &&
      (!Number.isInteger(sshExitCode) || sshExitCode < 0 || sshExitCode > 255)) {
    throw new Error('invalid sshExitCode');
  }
  if (!Number.isFinite(Date.parse(reportedAt))) {
    throw new Error('invalid reportedAt timestamp');
  }

  const payload = {
    type: 'slaif.jobReport',
    version: 1,
    sessionId: safeSessionId,
    hpc: safeHpc,
    status,
    reportedAt: new Date(Date.parse(reportedAt)).toISOString(),
  };
  if (scheduler !== undefined) {
    payload.scheduler = scheduler;
  }
  if (jobId !== undefined) {
    payload.jobId = jobId;
  }
  if (sshExitCode !== undefined) {
    payload.sshExitCode = sshExitCode;
  }
  return payload;
}

export async function postJobReport({
  apiBaseUrl,
  sessionId,
  hpc,
  jobReportToken,
  jobReportTokenExpiresAt,
  policy,
  allowLocalDev = false,
  report,
  fetchImpl = globalThis.fetch,
}) {
  assertPlainObject(report, 'job report');
  validateOpaqueToken(jobReportToken, 'jobReportToken');
  validateJobReportTokenExpiresAt(jobReportTokenExpiresAt);
  const endpoint = buildJobReportEndpoint(apiBaseUrl, sessionId, policy, {allowLocalDev});
  const payload = buildJobReportPayload({sessionId, hpc, ...report});
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
    throw new Error(`job report rejected by SLAIF API: ${response.status}`);
  }
  return payload;
}
