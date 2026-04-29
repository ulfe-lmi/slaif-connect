#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
UPSTREAM="$ROOT/third_party/libapps"
BUILD="$ROOT/build/extension"
VENDOR_META="$ROOT/extension/vendor/libapps/VENDORED_FROM.json"

if [ ! -d "$UPSTREAM" ]; then
  echo "Missing third_party/libapps. Run npm run upstream:init first." >&2
  exit 1
fi

if [ ! -f "$VENDOR_META" ]; then
  "$ROOT/scripts/vendor-libapps.sh"
fi

plugin_status="missing"
if [ -d "$ROOT/extension/plugin" ]; then
  if SLAIF_VERIFY_PLUGIN_SKIP_BUILD=1 node "$ROOT/scripts/verify-plugin.js"; then
    plugin_status="verified"
  else
    echo "Plugin artifacts are present but failed verification." >&2
    exit 1
  fi
fi

rm -rf "$BUILD"
mkdir -p "$BUILD"

rsync -a --delete \
  "$ROOT/extension/" "$BUILD/"

for required in \
  manifest.json \
  js/background.js \
  js/session.js \
  vendor/libapps/VENDORED_FROM.json; do
  if [ ! -f "$BUILD/$required" ]; then
    echo "Build output missing required file: build/extension/$required" >&2
    exit 1
  fi
done

if [ ! -d "$BUILD/plugin" ]; then
  echo "warning: extension/plugin missing; OpenSSH/WASM artifacts are not bundled yet" >&2
fi

echo "Built unpacked extension at $BUILD"
if [ "$plugin_status" = "verified" ]; then
  echo "OpenSSH/WASM plugin artifacts were verified and bundled."
else
  echo "Browser SSH prototype files were packaged, but plugin artifacts are missing."
fi
