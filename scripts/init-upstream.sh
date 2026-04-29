#!/usr/bin/env bash
set -euo pipefail

if [ -d third_party/libapps/.git ]; then
  echo "third_party/libapps already exists"
else
  git submodule add https://chromium.googlesource.com/apps/libapps third_party/libapps
fi

git submodule update --init --recursive
git -C third_party/libapps rev-parse HEAD > UPSTREAM_LIBAPPS_COMMIT

echo "Pinned upstream libapps commit: $(cat UPSTREAM_LIBAPPS_COMMIT)"
