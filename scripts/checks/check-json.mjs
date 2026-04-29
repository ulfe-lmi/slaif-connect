import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', 'build', 'dist', 'third_party']);
const skipPrefixes = ['extension/vendor', 'extension/plugin'];

function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === 'extension/vendor/libapps/VENDORED_FROM.json') {
    return false;
  }
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
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

const files = walk(root);
const vendorMetadata = path.join(root, 'extension/vendor/libapps/VENDORED_FROM.json');
if (fs.existsSync(vendorMetadata)) {
  files.push(vendorMetadata);
}

for (const file of files) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('JSON syntax OK');
