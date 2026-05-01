node="$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9_.:-' | cut -c1-128)"
[ -n "$node" ] || node="unknown"
job_id="${SLAIF_SLURM_JOB_ID:-${SLURM_JOB_ID:-}}"
case "$job_id" in
  ''|*[!0-9]*) job_id_json="" ;;
  *) job_id_json=",\"jobId\":\"$job_id\"" ;;
esac

printf '%s\n' 'SLAIF_PAYLOAD_RESULT_BEGIN'
if command -v nvidia-smi >/dev/null 2>&1; then
  driver="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -n1 | tr -cd 'A-Za-z0-9_.:-' | cut -c1-64 || true)"
  gpu_lines="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n64 || true)"
  if [ -n "$gpu_lines" ]; then
    printf '{"type":"slaif.payloadResult","version":1,"sessionId":"%s","hpc":"%s","payloadId":"gpu_diagnostics_v1","scheduler":"slurm"%s,"status":"completed","result":{"node":"%s","gpus":[' \
      "${SLAIF_SESSION_ID:-}" \
      "${SLAIF_HPC_ALIAS:-}" \
      "$job_id_json" \
      "$node"
    first=1
    printf '%s\n' "$gpu_lines" | while IFS=, read -r raw_name raw_mem; do
      name="$(printf '%s' "$raw_name" | sed 's/^ *//;s/ *$//' | tr -cd 'A-Za-z0-9 _./:@%+=,()[\]-' | cut -c1-128)"
      mem="$(printf '%s' "$raw_mem" | tr -cd '0-9')"
      [ -n "$name" ] || name="unknown GPU"
      case "$mem" in
        ''|*[!0-9]*) mem=1 ;;
      esac
      if [ "$first" -eq 0 ]; then
        printf ','
      fi
      first=0
      printf '{"name":"%s","memoryTotalMiB":%s' "$name" "$mem"
      [ -n "$driver" ] && printf ',"driverVersion":"%s"' "$driver"
      printf '}'
    done
    printf '],"gpuAvailable":true}}\n'
  else
    printf '{"type":"slaif.payloadResult","version":1,"sessionId":"%s","hpc":"%s","payloadId":"gpu_diagnostics_v1","scheduler":"slurm"%s,"status":"no_gpu_detected","result":{"node":"%s","gpus":[],"gpuAvailable":false,"reason":"nvidia-smi query returned no GPUs"}}\n' \
      "${SLAIF_SESSION_ID:-}" \
      "${SLAIF_HPC_ALIAS:-}" \
      "$job_id_json" \
      "$node"
  fi
else
  printf '{"type":"slaif.payloadResult","version":1,"sessionId":"%s","hpc":"%s","payloadId":"gpu_diagnostics_v1","scheduler":"slurm"%s,"status":"no_gpu_detected","result":{"node":"%s","gpus":[],"gpuAvailable":false,"reason":"nvidia-smi not available"}}\n' \
    "${SLAIF_SESSION_ID:-}" \
    "${SLAIF_HPC_ALIAS:-}" \
    "$job_id_json" \
    "$node"
fi
printf '%s\n' 'SLAIF_PAYLOAD_RESULT_END'
