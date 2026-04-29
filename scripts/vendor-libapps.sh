#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="$ROOT/third_party/libapps"
OUT="$ROOT/extension/vendor/libapps"

if [ ! -d "$UPSTREAM" ]; then
  echo "Missing $UPSTREAM. Run ./scripts/init-upstream.sh first." >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

copy_dir() {
  local name="$1"
  if [ -d "$UPSTREAM/$name" ]; then
    mkdir -p "$OUT/$name"
    rsync -a --delete "$UPSTREAM/$name/" "$OUT/$name/"
  else
    echo "warning: upstream directory missing: $name" >&2
  fi
}

copy_dir hterm
copy_dir libdot
copy_dir wassh
copy_dir wasi-js-bindings

# MVP: copy selected nassh JS runtime files broadly, then shrink later.
# This is still not a fork because the source of truth remains third_party/libapps.
mkdir -p "$OUT/nassh/js"
if [ -d "$UPSTREAM/nassh/js" ]; then
  rsync -a "$UPSTREAM/nassh/js/" "$OUT/nassh/js/"
fi

# Copy plugin artifacts if upstream checkout already has them.
mkdir -p "$ROOT/extension/plugin"
if [ -d "$UPSTREAM/nassh/plugin" ]; then
  rsync -a "$UPSTREAM/nassh/plugin/" "$ROOT/extension/plugin/"
else
  echo "warning: upstream nassh/plugin not present; build or install ssh_client WASM artifacts separately" >&2
fi

# Preserve license/notice files when present.
for f in LICENSE README.md; do
  if [ -f "$UPSTREAM/$f" ]; then
    cp "$UPSTREAM/$f" "$OUT/$f"
  fi
done

git -C "$UPSTREAM" rev-parse HEAD > "$ROOT/UPSTREAM_LIBAPPS_COMMIT"

echo "Vendored libapps runtime files into $OUT"
echo "Pinned commit: $(cat "$ROOT/UPSTREAM_LIBAPPS_COMMIT")"
