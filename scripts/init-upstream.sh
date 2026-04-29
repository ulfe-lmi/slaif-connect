#!/usr/bin/env bash
set -euo pipefail

cat <<'MSG'
SLAIF Connect will use Chromium libapps as a pinned build-time dependency.

This starter PR does not initialize upstream automatically. A later PR should:

  git submodule add https://chromium.googlesource.com/apps/libapps third_party/libapps
  git submodule update --init --recursive
  git -C third_party/libapps rev-parse HEAD > UPSTREAM_LIBAPPS_COMMIT

After that, run:

  ./scripts/vendor-libapps.sh

Do not edit files under third_party/libapps directly.
MSG
