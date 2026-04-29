#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/extension"

rm -rf "$DIST"
mkdir -p "$DIST"

rsync -a --delete \
  --exclude 'vendor/' \
  "$ROOT/extension/" "$DIST/"

if [ -d "$ROOT/extension/vendor" ]; then
  rsync -a "$ROOT/extension/vendor" "$DIST/"
else
  echo "warning: extension/vendor missing; run ./scripts/vendor-libapps.sh once upstream is initialized" >&2
fi

if [ -d "$ROOT/extension/plugin" ]; then
  rsync -a "$ROOT/extension/plugin" "$DIST/"
fi

echo "Built unpacked extension at $DIST"
