#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="https://chromium.googlesource.com/apps/libapps"
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
UPSTREAM="$ROOT/third_party/libapps"

if [ ! -f "$ROOT/.gitmodules" ] || ! git -C "$ROOT" config --file .gitmodules --get submodule.third_party/libapps.url >/dev/null; then
  echo "Missing third_party/libapps submodule config. Add it with:" >&2
  echo "  git submodule add $UPSTREAM_URL third_party/libapps" >&2
  exit 1
fi

git -C "$ROOT" submodule update --init --recursive third_party/libapps

missing=0
for dir in hterm libdot wassh wasi-js-bindings nassh ssh_client; do
  if [ ! -d "$UPSTREAM/$dir" ]; then
    echo "missing: third_party/libapps/$dir" >&2
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Upstream libapps checkout is incomplete." >&2
  exit 1
fi

commit="$(git -C "$UPSTREAM" rev-parse HEAD)"
printf '%s\n' "$commit" > "$ROOT/UPSTREAM_LIBAPPS_COMMIT"
printf '%s\n' "$UPSTREAM_URL" > "$ROOT/UPSTREAM_LIBAPPS_URL"

cat <<MSG
Upstream libapps initialized.
URL: $UPSTREAM_URL
Pinned commit: $commit
Expected directories: found
MSG
