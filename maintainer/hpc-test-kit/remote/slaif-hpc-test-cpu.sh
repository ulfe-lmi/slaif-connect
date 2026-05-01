#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

slaif_require_remote_base_dir
RESULT_DIR="$(slaif_result_dir cpu)"
JOB_SCRIPT="$RESULT_DIR/cpu-diagnostic.sbatch"
OUT_FILE="$RESULT_DIR/slurm-%j.out"

cat >"$JOB_SCRIPT" <<'SBATCH'
#!/usr/bin/env bash
set -euo pipefail
echo "slaif_cpu_diagnostic_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
hostname || true
date -u || true
command -v nproc >/dev/null 2>&1 && nproc || true
command -v lscpu >/dev/null 2>&1 && lscpu | head -n 40 || true
command -v free >/dev/null 2>&1 && free -h || true
if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import json
import os
import platform
payload = {
    "type": "slaif.cpuMemoryDiagnosticsResult.v1",
    "hostname": platform.node(),
    "cpuCount": os.cpu_count(),
}
print(json.dumps(payload, sort_keys=True))
PY
else
  echo '{"type":"slaif.cpuMemoryDiagnosticsResult.v1","python3Available":false}'
fi
echo "slaif_cpu_diagnostic_done=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SBATCH

HEADER="$RESULT_DIR/header.sbatch"
{
  echo '#SBATCH --job-name=slaif-cpu-diag'
  echo "#SBATCH --output=$OUT_FILE"
  slaif_append_sbatch_option "$HEADER" "account" "${SLAIF_SLURM_ACCOUNT:-}"
  slaif_append_sbatch_option "$HEADER" "partition" "${SLAIF_SLURM_CPU_PARTITION:-}"
  slaif_append_sbatch_option "$HEADER" "qos" "${SLAIF_SLURM_QOS:-}"
  slaif_append_sbatch_option "$HEADER" "time" "${SLAIF_SLURM_TIME_LIMIT:-00:05:00}"
  slaif_append_sbatch_option "$HEADER" "mem" "${SLAIF_SLURM_MEMORY:-1G}"
  slaif_append_sbatch_option "$HEADER" "cpus-per-task" "${SLAIF_SLURM_CPUS_PER_TASK:-1}"
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
  slaif_wait_for_job "$JOB_ID" 300 || true
fi
slaif_write_result_json "$RESULT_DIR/result.json" "submitted" "Submitted batch job $JOB_ID"
