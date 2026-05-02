#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/slaif-hpc-test-common.sh"

RESULT_DIR="$(slaif_result_dir launcher-intent)"
LAUNCHER="${REMOTE_BASE_DIR}/bin/slaif-launch"
INTENT_FILE="${SLAIF_LAUNCHER_INTENT_FILE:-${REMOTE_BASE_DIR}/kit/launcher-intent/session-intent.json}"
PROFILE_FILE="${SLAIF_LAUNCHER_PROFILE_FILE:-${REMOTE_BASE_DIR}/kit/launcher-intent/slurm-profiles.json}"
WORK_DIR="${REMOTE_BASE_DIR}/launcher-work"

if [ ! -x "$LAUNCHER" ]; then
  echo "uploaded launcher is missing or not executable: $LAUNCHER" >&2
  exit 2
fi

if [ ! -f "$INTENT_FILE" ] || [ ! -f "$PROFILE_FILE" ]; then
  echo "launcher intent/profile files are missing" >&2
  exit 2
fi

mkdir -p "$WORK_DIR"
if [ "${SLAIF_LAUNCHER_INTENT_SUBMIT:-0}" = "1" ]; then
  "$LAUNCHER" \
    --session "${SLAIF_LAUNCHER_INTENT_SESSION_ID:-sess_maintainer_intent}" \
    --intent-file "$INTENT_FILE" \
    --profile-file "$PROFILE_FILE" \
    --work-dir "$WORK_DIR" \
    --wait-result | tee "$RESULT_DIR/launcher-intent-output.txt"
else
  "$LAUNCHER" \
    --session "${SLAIF_LAUNCHER_INTENT_SESSION_ID:-sess_maintainer_intent}" \
    --intent-file "$INTENT_FILE" \
    --profile-file "$PROFILE_FILE" \
    --work-dir "$WORK_DIR" \
    --dry-run | tee "$RESULT_DIR/launcher-intent-output.txt"
fi

slaif_write_result_json "$RESULT_DIR/result.json" "ok" "launcher payload-intent phase completed"
