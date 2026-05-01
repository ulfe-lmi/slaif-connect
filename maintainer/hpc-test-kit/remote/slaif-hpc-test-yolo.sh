#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

slaif_require_remote_base_dir

if [ "${SLAIF_ALLOW_YOLO:-0}" != "1" ]; then
  echo "refusing YOLO: SLAIF_ALLOW_YOLO=1 is required" >&2
  exit 2
fi
if [ "${SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE:-0}" != "1" ]; then
  echo "refusing YOLO: SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE=1 is required" >&2
  exit 2
fi
if [ -z "${SLAIF_YOLO_COMMAND:-}" ]; then
  echo "refusing YOLO: SLAIF_YOLO_COMMAND is required" >&2
  exit 2
fi

RESULT_DIR="$(slaif_result_dir yolo)"
echo "WARNING: maintainer-only YOLO test is running arbitrary code under this HPC account." | tee "$RESULT_DIR/warning.txt"

set +e
bash -lc "$SLAIF_YOLO_COMMAND" >"$RESULT_DIR/stdout.txt" 2>"$RESULT_DIR/stderr.txt"
STATUS="$?"
set -e

slaif_write_result_json "$RESULT_DIR/result.json" "completed" "YOLO command exit status $STATUS"
exit "$STATUS"
