#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

slaif_require_remote_base_dir
RESULT_DIR="$(slaif_result_dir discover)"
LOG="$RESULT_DIR/discover.txt"

{
  slaif_section "identity"
  hostname || true
  whoami || true
  pwd || true
  date -u || true
  uname -a || true
  printf 'SHELL=%s\n' "${SHELL:-}"
  printf 'HOME=%s\n' "${HOME:-}"

  slaif_section "modules"
  command -v module || true
  if command -v module >/dev/null 2>&1; then
    module avail 2>&1 | head -n 120 || true
  fi

  slaif_section "slurm commands"
  for cmd in sbatch srun sinfo squeue scontrol sacct sacctmgr; do
    command -v "$cmd" || true
  done

  slaif_section "slurm version"
  sbatch --version 2>&1 || true

  slaif_section "sinfo summary"
  sinfo -o "%P|%a|%l|%D|%t|%C|%G" 2>&1 | head -n 200 || true

  slaif_section "sinfo partitions"
  sinfo -s 2>&1 | head -n 200 || true

  slaif_section "scontrol partitions"
  if command -v scontrol >/dev/null 2>&1; then
    scontrol show partition 2>&1 | head -n 240 || true
  else
    echo "scontrol not available"
  fi

  slaif_section "user associations"
  if command -v sacctmgr >/dev/null 2>&1; then
    sacctmgr show assoc "user=$USER" format=Account,Partition,QOS%30 -P 2>&1 | head -n 200 || true
  else
    echo "sacctmgr not available"
  fi

  slaif_section "login-node gpu visibility"
  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi -L 2>&1 | head -n 80 || true
  else
    echo "nvidia-smi not available on login node"
  fi
} >"$LOG"

slaif_write_result_json "$RESULT_DIR/result.json" "ok" "discovery collected"
printf 'discover result directory: %s\n' "$RESULT_DIR"
