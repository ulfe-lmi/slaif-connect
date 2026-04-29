#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="https://chromium.googlesource.com/apps/libapps"
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
UPSTREAM="$ROOT/third_party/libapps"
OUT="$ROOT/extension/vendor/libapps"
PLUGIN_OUT="$ROOT/extension/plugin"

if [ ! -d "$UPSTREAM" ]; then
  echo "Missing $UPSTREAM. Run npm run upstream:init first." >&2
  exit 1
fi

if [ ! -d "$UPSTREAM/.git" ] && [ ! -f "$UPSTREAM/.git" ]; then
  echo "$UPSTREAM is not an initialized git submodule. Run npm run upstream:init first." >&2
  exit 1
fi

for dir in hterm libdot wassh wasi-js-bindings nassh/js; do
  if [ ! -d "$UPSTREAM/$dir" ]; then
    echo "Missing upstream path: third_party/libapps/$dir" >&2
    exit 1
  fi
done

commit="$(git -C "$UPSTREAM" rev-parse HEAD)"
printf '%s\n' "$commit" > "$ROOT/UPSTREAM_LIBAPPS_COMMIT"
printf '%s\n' "$UPSTREAM_URL" > "$ROOT/UPSTREAM_LIBAPPS_URL"

rm -rf "$OUT"
mkdir -p "$OUT"

copy_dir() {
  local name="$1"
  mkdir -p "$OUT/$name"
  rsync -a --delete "$UPSTREAM/$name/" "$OUT/$name/"
}

copy_dir hterm
copy_dir libdot
copy_dir wassh
copy_dir wasi-js-bindings

mkdir -p "$OUT/nassh/js"
rsync -a --delete "$UPSTREAM/nassh/js/" "$OUT/nassh/js/"

rm -rf "$PLUGIN_OUT"
if [ -d "$UPSTREAM/nassh/plugin" ]; then
  mkdir -p "$PLUGIN_OUT"
  rsync -a --delete "$UPSTREAM/nassh/plugin/" "$PLUGIN_OUT/"
  plugin_status="found"
else
  plugin_status="missing"
  echo "warning: upstream nassh/plugin not present; a later PR may need to build or install OpenSSH/WASM artifacts from ssh_client" >&2
fi

for f in LICENSE; do
  if [ -f "$UPSTREAM/$f" ]; then
    cp "$UPSTREAM/$f" "$OUT/$f"
  fi
done

cat > "$OUT/VENDORED_FROM.json" <<JSON
{
  "upstreamUrl": "$UPSTREAM_URL",
  "commit": "$commit",
  "copiedPaths": [
    "hterm",
    "libdot",
    "wassh",
    "wasi-js-bindings",
    "nassh/js"
  ]
}
JSON

echo "Vendored libapps runtime files into $OUT"
echo "Pinned commit: $commit"
echo "Plugin artifacts: $plugin_status"
