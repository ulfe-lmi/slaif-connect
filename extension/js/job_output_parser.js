const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export function boundSchedulerOutput(output, maxBytes = DEFAULT_MAX_OUTPUT_BYTES) {
  if (typeof output !== 'string') {
    return '';
  }
  const encoded = new TextEncoder().encode(output);
  if (encoded.byteLength <= maxBytes) {
    return output;
  }
  return new TextDecoder().decode(encoded.slice(encoded.byteLength - maxBytes));
}

export function parseSlurmJobSubmission(output, {maxBytes = DEFAULT_MAX_OUTPUT_BYTES} = {}) {
  const boundedOutput = boundSchedulerOutput(output, maxBytes).replace(/\r/g, '');
  if (!boundedOutput.trim()) {
    return {ok: false, scheduler: 'slurm', reason: 'empty_output'};
  }

  const matches = [...boundedOutput.matchAll(/^(?:sbatch:\s*)?Submitted batch job\s+([0-9]+)\s*$/gm)];
  if (matches.length === 0) {
    return {ok: false, scheduler: 'slurm', reason: 'no_job_id'};
  }

  const jobIds = [...new Set(matches.map((match) => match[1]))];
  if (jobIds.length > 1) {
    return {ok: false, scheduler: 'slurm', reason: 'ambiguous_job_id'};
  }

  return {
    ok: true,
    scheduler: 'slurm',
    jobId: jobIds[0],
  };
}

export function parseSchedulerJobSubmission(output, options = {}) {
  const scheduler = options.scheduler || 'slurm';
  if (scheduler !== 'slurm') {
    return {ok: false, scheduler, reason: 'unsupported_scheduler'};
  }
  return parseSlurmJobSubmission(output, options);
}

export function parseSlurmJobId(output) {
  const result = parseSlurmJobSubmission(output);
  return result.ok ? result.jobId : null;
}

export function buildJobStartedMessage({sessionId, hpc, jobId}) {
  if (!jobId || !/^[0-9]+$/.test(jobId)) {
    throw new Error(`invalid SLURM job id: ${jobId}`);
  }
  return {
    type: 'job_started',
    sessionId,
    hpc,
    jobId,
    createdAt: new Date().toISOString(),
  };
}
