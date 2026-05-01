#!/bin/sh
set -eu

slaif_launcher_fail() {
  code="$1"
  shift
  printf '%s\n' "$*" >&2
  exit "$code"
}

slaif_launcher_validate_session_id() {
  printf '%s\n' "$1" | grep -Eq '^sess_[A-Za-z0-9_-]{8,128}$'
}
