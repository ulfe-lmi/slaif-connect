import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pluginDir = path.join(root, 'extension/plugin');
const buildPluginDir = path.join(root, 'build/extension/plugin');
const commitPath = path.join(root, 'UPSTREAM_LIBAPPS_COMMIT');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

if (!fs.existsSync(commitPath)) {
  fail('Missing UPSTREAM_LIBAPPS_COMMIT');
}

const commit = fs.readFileSync(commitPath, 'utf8').trim();

if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
  fail('Missing extension/plugin. Run npm run plugin:install first.');
}

const files = walk(pluginDir);
const wasmFiles = files.filter((file) => file.endsWith('.wasm'));
if (wasmFiles.length === 0) {
  fail('extension/plugin does not contain any .wasm files');
}

if (!wasmFiles.some((file) => path.basename(file) === 'ssh.wasm')) {
  fail('extension/plugin is missing ssh.wasm');
}

if (process.env.SLAIF_VERIFY_PLUGIN_SKIP_BUILD !== '1' &&
    fs.existsSync(path.join(root, 'build/extension'))) {
  if (!fs.existsSync(buildPluginDir)) {
    fail('build/extension exists but build/extension/plugin is missing');
  }
  const buildWasmFiles = walk(buildPluginDir).filter((file) => file.endsWith('.wasm'));
  if (buildWasmFiles.length === 0) {
    fail('build/extension/plugin does not contain any .wasm files');
  }
}

console.log(`Plugin artifacts OK for libapps ${commit}`);
console.log(`Found ${wasmFiles.length} wasm artifact(s) under extension/plugin`);
