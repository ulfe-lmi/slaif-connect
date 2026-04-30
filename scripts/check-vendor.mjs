import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const vendorRoot = path.join(root, 'extension/vendor/libapps');
const requiredDirs = [
  'hterm',
  'libdot',
  'wassh',
  'wasi-js-bindings',
  'nassh/js',
  'nassh/wassh',
  'nassh/wasi-js-bindings',
];
const requiredFiles = [
  'hterm/dist/js/hterm_resources.js',
  'hterm/js/deps_punycode.rollup.js',
  'libdot/dist/js/libdot_resources.js',
  'nassh/js/deps_resources.rollup.js',
  'nassh/js/deps_indexeddb-fs.rollup.js',
  'nassh/js/deps_pkijs.rollup.js',
  'nassh/third_party/google-smart-card/google-smart-card-client-library.js',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const dir of requiredDirs) {
  const fullPath = path.join(vendorRoot, dir);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    fail(`Missing vendored directory: extension/vendor/libapps/${dir}`);
  }
}

for (const file of requiredFiles) {
  const fullPath = path.join(vendorRoot, file);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    fail(`Missing vendored generated file: extension/vendor/libapps/${file}`);
  }
}

const metadataPath = path.join(vendorRoot, 'VENDORED_FROM.json');
if (!fs.existsSync(metadataPath)) {
  fail('Missing extension/vendor/libapps/VENDORED_FROM.json');
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const pinnedCommitPath = path.join(root, 'UPSTREAM_LIBAPPS_COMMIT');
if (!fs.existsSync(pinnedCommitPath)) {
  fail('Missing UPSTREAM_LIBAPPS_COMMIT');
}

const pinnedCommit = fs.readFileSync(pinnedCommitPath, 'utf8').trim();
if (metadata.commit !== pinnedCommit) {
  fail(`Vendored commit ${metadata.commit} does not match pinned commit ${pinnedCommit}`);
}

if (metadata.upstreamUrl !== 'https://chromium.googlesource.com/apps/libapps') {
  fail(`Unexpected upstream URL in VENDORED_FROM.json: ${metadata.upstreamUrl}`);
}

for (const copiedPath of requiredDirs) {
  if (!metadata.copiedPaths.includes(copiedPath)) {
    fail(`VENDORED_FROM.json missing copied path: ${copiedPath}`);
  }
}

for (const copiedPath of requiredFiles) {
  if (!metadata.copiedPaths.includes(copiedPath)) {
    fail(`VENDORED_FROM.json missing copied path: ${copiedPath}`);
  }
}

if (!fs.existsSync(path.join(root, 'extension/plugin'))) {
  console.warn('warning: extension/plugin missing; OpenSSH/WASM plugin artifacts are not available yet');
}

for (const dir of ['extension/wassh/js', 'extension/wasi-js-bindings/js']) {
  const fullPath = path.join(root, dir);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    fail(`Missing generated browser compatibility directory: ${dir}`);
  }
}

console.log('Vendor output OK');
