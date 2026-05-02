node="$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9_.:-' | cut -c1-128)"
[ -n "$node" ] || node="unknown"
arch="$(uname -m 2>/dev/null | tr -cd 'A-Za-z0-9_.:-' | cut -c1-64 || true)"
cpu_count=""
if command -v nproc >/dev/null 2>&1; then
  cpu_count="$(nproc 2>/dev/null || true)"
fi
case "$cpu_count" in
  ''|*[!0-9]*) cpu_count=1 ;;
esac
memory_mib=""
if [ -r /proc/meminfo ]; then
  memory_kib="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)"
  case "$memory_kib" in
    ''|*[!0-9]*) ;;
    *) memory_mib=$((memory_kib / 1024)) ;;
  esac
fi
case "$memory_mib" in
  ''|*[!0-9]*) memory_mib=1 ;;
esac
job_id="${SLAIF_SLURM_JOB_ID:-${SLURM_JOB_ID:-}}"
case "$job_id" in
  ''|*[!0-9]*) job_id_json="" ;;
  *) job_id_json=",\"jobId\":\"$job_id\"" ;;
esac
partition="${SLURM_JOB_PARTITION:-}"
partition="$(printf '%s' "$partition" | tr -cd 'A-Za-z0-9_.:@%+=,/-' | cut -c1-128)"
partition_json=""
[ -n "$partition" ] && partition_json=",\"slurmPartition\":\"$partition\""

printf '%s\n' 'SLAIF_PAYLOAD_RESULT_BEGIN'
printf '{"type":"slaif.payloadResult","version":1,"sessionId":"%s","hpc":"%s","payloadId":"cpu_memory_diagnostics_v1","scheduler":"slurm"%s,"status":"completed","result":{"node":"%s","cpuCount":%s,"memoryTotalMiB":%s' \
  "${SLAIF_SESSION_ID:-}" \
  "${SLAIF_HPC_ALIAS:-}" \
  "$job_id_json" \
  "$node" \
  "$cpu_count" \
  "$memory_mib"
[ -n "$arch" ] && printf ',"architecture":"%s"' "$arch"
printf '%s' "$partition_json"
printf '}}\n'
printf '%s\n' 'SLAIF_PAYLOAD_RESULT_END'
