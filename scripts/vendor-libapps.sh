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

# The pinned nassh low-level modules import ../wassh from within nassh/js.
# Create a generated compatibility copy in the vendored tree without touching
# third_party/libapps.
mkdir -p "$OUT/nassh/wassh"
rsync -a --delete "$UPSTREAM/wassh/" "$OUT/nassh/wassh/"

# The upstream source tree expects generated rollup bundles. For the low-level
# SLAIF prototype we provide minimal generated local bundles rather than
# modifying upstream or loading runtime code remotely.
cat > "$OUT/nassh/js/deps_resources.rollup.js" <<'JS'
const blankSvg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

export const IMG_VISIBILITY_URI = blankSvg;
export const IMG_VISIBILITY_OFF_URI = blankSvg;
export const RELEASE_NOTES = [];
export const RELEASE_LAST_VERSION = 'SLAIF Connect prototype';
export const GIT_COMMIT = 'generated-slaif-vendor';
export const GIT_DATE = 'generated-slaif-vendor';
JS

cat > "$OUT/nassh/js/deps_indexeddb-fs.rollup.js" <<'JS'
function normalize(path) {
  if (!path || path === '.') {
    return '/';
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function parentOf(path) {
  path = normalize(path);
  if (path === '/') {
    return '/';
  }
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

export function createFs() {
  const entries = new Map([
    ['/', {type: 'directory', createdAt: Date.now()}],
  ]);

  return {
    async createDirectory(path) {
      path = normalize(path);
      const parent = parentOf(path);
      if (!entries.has(parent)) {
        await this.createDirectory(parent);
      }
      entries.set(path, {type: 'directory', createdAt: Date.now()});
    },

    async writeFile(path, data) {
      path = normalize(path);
      const parent = parentOf(path);
      if (!entries.has(parent)) {
        await this.createDirectory(parent);
      }
      entries.set(path, {
        type: 'file',
        data,
        createdAt: Date.now(),
      });
    },

    async readFile(path) {
      path = normalize(path);
      const entry = entries.get(path);
      if (!entry || entry.type !== 'file') {
        throw new Error(`file not found: ${path}`);
      }
      return entry.data;
    },

    async removeFile(path) {
      path = normalize(path);
      const entry = entries.get(path);
      if (!entry || entry.type !== 'file') {
        throw new Error(`file not found: ${path}`);
      }
      entries.delete(path);
    },

    async copyFile(oldPath, newPath) {
      const data = await this.readFile(oldPath);
      await this.writeFile(newPath, data);
    },

    async details(path) {
      path = normalize(path);
      const entry = entries.get(path);
      if (!entry) {
        throw new Error(`path not found: ${path}`);
      }
      return {
        type: entry.type,
        createdAt: entry.createdAt,
      };
    },

    async readDirectory(path) {
      path = normalize(path);
      const prefix = path === '/' ? '/' : `${path}/`;
      const files = [];
      for (const [entryPath, entry] of entries) {
        if (entryPath === path || !entryPath.startsWith(prefix)) {
          continue;
        }
        const name = entryPath.slice(prefix.length);
        if (!name || name.includes('/')) {
          continue;
        }
        files.push({name, type: entry.type});
      }
      return {files};
    },
  };
}
JS

if [ -d "$UPSTREAM/nassh/plugin" ]; then
  rm -rf "$PLUGIN_OUT"
  mkdir -p "$PLUGIN_OUT"
  rsync -a --delete "$UPSTREAM/nassh/plugin/" "$PLUGIN_OUT/"
  plugin_status="found"
elif [ -d "$PLUGIN_OUT" ]; then
  plugin_status="preinstalled"
else
  plugin_status="missing"
  echo "warning: extension/plugin not present; run npm run plugin:install before browser OpenSSH/WASM testing" >&2
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
    "nassh/js",
    "nassh/wassh",
    "nassh/js/deps_resources.rollup.js",
    "nassh/js/deps_indexeddb-fs.rollup.js"
  ]
}
JSON

echo "Vendored libapps runtime files into $OUT"
echo "Pinned commit: $commit"
echo "Plugin artifacts: $plugin_status"
