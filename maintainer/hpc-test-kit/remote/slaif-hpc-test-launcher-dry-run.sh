#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

slaif_require_remote_base_dir
RESULT_DIR="$(slaif_result_dir launcher-dry-run)"
LAUNCHER="$REMOTE_BASE_DIR/bin/slaif-launch"

if [ ! -x "$LAUNCHER" ]; then
  echo "uploaded launcher is missing or not executable: $LAUNCHER" >&2
  exit 2
fi

SAFE_SUFFIX="$(date -u +%Y%m%dT%H%M%S)"
OUTPUT="$("$LAUNCHER" --session "sess_maintainer_test_${SAFE_SUFFIX}" --dry-run)"
printf '%s\n' "$OUTPUT" | tee "$RESULT_DIR/launcher-output.txt"

if ! printf '%s\n' "$OUTPUT" | grep -Eq '^Submitted batch job [0-9]+$'; then
  slaif_write_result_json "$RESULT_DIR/result.json" "failed" "launcher dry-run did not print canonical Slurm submission line"
  exit 1
fi

slaif_write_result_json "$RESULT_DIR/result.json" "ok" "launcher dry-run printed canonical Slurm submission line"
