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
import os
import platform
import shutil
import subprocess
node = platform.node() or "unknown"
gpus = []
status = "no_gpu_detected"
gpu_available = False
reason = "nvidia-smi not available"
if shutil.which("nvidia-smi"):
    try:
        query = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
            check=False,
            text=True,
            capture_output=True,
            timeout=20,
        )
        if query.returncode == 0:
            for line in query.stdout.splitlines()[:64]:
                parts = [part.strip() for part in line.split(",")]
                if len(parts) >= 2:
                    entry = {"name": parts[0] or "unknown GPU"}
                    if parts[1].isdigit():
                        entry["memoryTotalMiB"] = int(parts[1])
                    if len(parts) >= 3 and parts[2]:
                        entry["driverVersion"] = parts[2]
                    gpus.append(entry)
            if gpus:
                status = "completed"
                gpu_available = True
                reason = None
    except Exception:
        pass
payload = {
    "type": "slaif.payloadResult",
    "version": 1,
    "sessionId": os.environ.get("SLAIF_DIAGNOSTIC_SESSION_ID", "sess_maintainer_gpu"),
    "hpc": os.environ.get("SLAIF_HPC_ALIAS", "maintainerhpc"),
    "payloadId": "gpu_diagnostics_v1",
    "scheduler": "slurm",
    "jobId": os.environ.get("SLURM_JOB_ID", ""),
    "status": status,
    "result": {
        "node": node,
        "gpus": gpus,
        "gpuAvailable": gpu_available,
    },
}
if reason:
    payload["result"]["reason"] = reason
if not payload["jobId"]:
    payload.pop("jobId")
print("SLAIF_PAYLOAD_RESULT_BEGIN")
print(json.dumps(payload, sort_keys=True))
print("SLAIF_PAYLOAD_RESULT_END")
PY
else
  echo 'SLAIF_PAYLOAD_RESULT_BEGIN'
  printf '{"type":"slaif.payloadResult","version":1,"sessionId":"sess_maintainer_gpu","hpc":"%s","payloadId":"gpu_diagnostics_v1","scheduler":"slurm","jobId":"%s","status":"no_gpu_detected","result":{"node":"unknown","gpus":[],"gpuAvailable":false,"reason":"python3 not available"}}\n' "${SLAIF_HPC_ALIAS:-maintainerhpc}" "${SLURM_JOB_ID:-}"
  echo 'SLAIF_PAYLOAD_RESULT_END'
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
  if [ -f "$RESULT_DIR/slurm-$JOB_ID.out" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$RESULT_DIR/slurm-$JOB_ID.out" "$RESULT_DIR/gpu_payload_result.json" <<'PY' || true
import pathlib
import sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
begin = text.find("SLAIF_PAYLOAD_RESULT_BEGIN")
end = text.find("SLAIF_PAYLOAD_RESULT_END", begin)
if begin >= 0 and end > begin:
    body = text[begin + len("SLAIF_PAYLOAD_RESULT_BEGIN"):end].strip()
    pathlib.Path(sys.argv[2]).write_text(body + "\n", encoding="utf-8")
PY
  fi
fi
slaif_write_result_json "$RESULT_DIR/result.json" "submitted" "Submitted batch job $JOB_ID"
