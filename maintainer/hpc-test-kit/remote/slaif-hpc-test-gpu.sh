#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

slaif_require_remote_base_dir
RESULT_DIR="$(slaif_result_dir gpu)"
JOB_SCRIPT="$RESULT_DIR/gpu-diagnostic.sbatch"
OUT_FILE="$RESULT_DIR/slurm-%j.out"
HEADER="$RESULT_DIR/header.sbatch"

cat >"$JOB_SCRIPT" <<'SBATCH'
#!/usr/bin/env bash
set -euo pipefail
echo "slaif_gpu_diagnostic_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
hostname || true
date -u || true
echo "CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-}"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi -L || true
  nvidia-smi || true
else
  echo "nvidia-smi not available in allocation"
fi
if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import json
payload = {
    "type": "slaif.gpuDiagnosticsResult.v1",
    "python3Available": True,
}
print(json.dumps(payload, sort_keys=True))
PY
else
  echo '{"type":"slaif.gpuDiagnosticsResult.v1","python3Available":false}'
fi
echo "slaif_gpu_diagnostic_done=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SBATCH

{
  echo '#SBATCH --job-name=slaif-gpu-diag'
  echo "#SBATCH --output=$OUT_FILE"
  slaif_append_sbatch_option "$HEADER" "account" "${SLAIF_SLURM_ACCOUNT:-}"
  slaif_append_sbatch_option "$HEADER" "partition" "${SLAIF_SLURM_GPU_PARTITION:-}"
  slaif_append_sbatch_option "$HEADER" "qos" "${SLAIF_SLURM_QOS:-}"
  slaif_append_sbatch_option "$HEADER" "time" "${SLAIF_SLURM_TIME_LIMIT:-00:05:00}"
  slaif_append_sbatch_option "$HEADER" "mem" "${SLAIF_SLURM_MEMORY:-1G}"
  slaif_append_sbatch_option "$HEADER" "cpus-per-task" "${SLAIF_SLURM_CPUS_PER_TASK:-1}"
  if [ -n "${SLAIF_SLURM_GPU_GRES:-}" ]; then
    echo "#SBATCH --gres=$SLAIF_SLURM_GPU_GRES"
  elif [ -n "${SLAIF_SLURM_GPUS:-}" ] && [ "${SLAIF_SLURM_GPUS:-0}" != "0" ]; then
    echo "#SBATCH --gpus=$SLAIF_SLURM_GPUS"
  fi
} >"$HEADER"
sed -i '1r '"$HEADER" "$JOB_SCRIPT"

SUBMIT_OUTPUT="$(sbatch "$JOB_SCRIPT")"
printf '%s\n' "$SUBMIT_OUTPUT"
JOB_ID="$(printf '%s\n' "$SUBMIT_OUTPUT" | sed -n 's/^Submitted batch job \([0-9][0-9]*\)$/\1/p' | head -n 1)"
if [ -z "$JOB_ID" ]; then
  slaif_write_result_json "$RESULT_DIR/result.json" "failed" "could not parse sbatch job id"
  exit 1
fi
if [ "${SLAIF_WAIT_FOR_COMPLETION:-0}" = "1" ]; then
  slaif_wait_for_job "$JOB_ID" 600 || true
fi
slaif_write_result_json "$RESULT_DIR/result.json" "submitted" "Submitted batch job $JOB_ID"
