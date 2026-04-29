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

if (!fs.existsSync(path.join(root, 'extension/plugin'))) {
  console.warn('warning: extension/plugin missing; OpenSSH/WASM plugin artifacts are not available yet');
}

console.log('Vendor output OK');
