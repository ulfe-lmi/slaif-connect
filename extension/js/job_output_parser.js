export function parseSlurmJobId(output) {
  if (typeof output !== 'string') {
    return null;
  }

  const patterns = [
    /^Submitted batch job\s+([0-9]+)\s*$/m,
    /\bSubmitted batch job\s+([0-9]+)\b/m,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
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
