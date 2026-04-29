#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
UPSTREAM="$ROOT/third_party/libapps"
OUT="$ROOT/extension/plugin"

if [ ! -d "$UPSTREAM" ]; then
  echo "Missing third_party/libapps. Run npm run upstream:init first." >&2
  exit 1
fi

if [ ! -f "$UPSTREAM/nassh/bin/plugin" ]; then
  echo "Missing upstream plugin helper: third_party/libapps/nassh/bin/plugin" >&2
  exit 1
fi

if [ ! -f "$UPSTREAM/nassh/fetch.json" ]; then
  echo "Missing upstream plugin manifest: third_party/libapps/nassh/fetch.json" >&2
  exit 1
fi

commit="$(git -C "$UPSTREAM" rev-parse HEAD)"
printf '%s\n' "$commit" > "$ROOT/UPSTREAM_LIBAPPS_COMMIT"

echo "Installing OpenSSH/WASM plugin artifacts from pinned libapps $commit"
echo "Output: $OUT"

python3 - "$UPSTREAM" "$OUT" <<'PY'
import pathlib
import shutil
import sys

upstream = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])

sys.path.insert(0, str(upstream / "libdot" / "bin"))
import libdot  # pylint: disable=import-error,wrong-import-position

shutil.rmtree(out, ignore_errors=True)
out.parent.mkdir(parents=True, exist_ok=True)

# Use the same upstream-supported manifest downloader as nassh/bin/plugin, but
# direct the generated files into extension/plugin so third_party/libapps stays
# untouched.
libdot.download_tarball_manifest(upstream / "nassh" / "fetch.json", "plugin", out)
PY

echo "Plugin artifacts installed into extension/plugin"
