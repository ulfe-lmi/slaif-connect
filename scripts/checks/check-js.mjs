import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', 'build', 'dist', 'third_party']);
const skipPrefixes = ['extension/vendor', 'extension/plugin'];

function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return relativePath.split(path.sep).some((part) => skipDirs.has(part)) ||
      skipPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (shouldSkip(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
    } else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

for (const file of walk(root)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log('JS syntax OK');
