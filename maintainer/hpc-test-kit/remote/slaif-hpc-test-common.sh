#!/usr/bin/env bash
set -euo pipefail

slaif_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

slaif_section() {
  printf '\n== %s ==\n' "$1"
}

slaif_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'
}

slaif_require_remote_base_dir() {
  : "${REMOTE_BASE_DIR:?REMOTE_BASE_DIR is required}"
  case "$REMOTE_BASE_DIR" in
    "/"|"/tmp"|"/etc"|"/etc/"*|"/usr"|"/usr/"*|"/opt"|"/opt/"*|"/bin"|"/bin/"*|"/sbin"|"/sbin/"*)
      echo "unsafe REMOTE_BASE_DIR: $REMOTE_BASE_DIR" >&2
      exit 2
      ;;
  esac
  mkdir -p "$REMOTE_BASE_DIR/results" "$REMOTE_BASE_DIR/work" "$REMOTE_BASE_DIR/bin"
}

slaif_result_dir() {
  local name="$1"
  local dir="$REMOTE_BASE_DIR/results/${name}-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

slaif_command_exists() {
  command -v "$1" >/dev/null 2>&1
}

slaif_append_sbatch_option() {
  local file="$1"
  local name="$2"
  local value="$3"
  if [ -n "$value" ]; then
    printf '#SBATCH --%s=%s\n' "$name" "$value" >>"$file"
  fi
}

slaif_write_result_json() {
  local file="$1"
  local status="$2"
  local detail="$3"
  cat >"$file" <<JSON
{
  "type": "slaif.hpcTestResult",
  "version": 1,
  "createdAt": "$(slaif_now)",
  "status": "$(slaif_json_escape "$status")",
  "detail": "$(slaif_json_escape "$detail")"
}
JSON
}

slaif_wait_for_job() {
  local job_id="$1"
  local timeout_seconds="${2:-300}"
  local deadline=$((SECONDS + timeout_seconds))
  if ! slaif_command_exists squeue; then
    return 0
  fi
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! squeue -j "$job_id" -h >/dev/null 2>&1; then
      return 0
    fi
    if [ -z "$(squeue -j "$job_id" -h 2>/dev/null || true)" ]; then
      return 0
    fi
    sleep 5
  done
  echo "timed out waiting for Slurm job $job_id" >&2
  return 1
}
