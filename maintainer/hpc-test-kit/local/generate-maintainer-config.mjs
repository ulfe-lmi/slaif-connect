import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const systemToExample = new Map([
  ['vega', 'vega.example.json'],
  ['arnes', 'arnes.example.json'],
  ['nsc', 'nsc.example.json'],
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--system') {
      args.system = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

function expandHome(value) {
  return value.replace(/^~(?=$|\/)/, os.homedir());
}

try {
  const args = parseArgs(process.argv);
  if (!systemToExample.has(args.system)) {
    throw new Error('--system must be vega, arnes, or nsc');
  }
  if (!args.out) {
    throw new Error('--out is required');
  }
  const here = path.dirname(new URL(import.meta.url).pathname);
  const examplePath = path.resolve(here, '../configs', systemToExample.get(args.system));
  const outPath = path.resolve(expandHome(args.out));
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.copyFileSync(examplePath, outPath);
  fs.chmodSync(outPath, 0o600);
  console.log(`Wrote maintainer config template to ${outPath}`);
} catch (error) {
  console.error(`failed to generate maintainer config: ${error.message}`);
  process.exit(1);
}
