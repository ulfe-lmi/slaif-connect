#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {
  fingerprintsFromKnownHosts,
  parseCliArgs,
} from './pilot_lib.mjs';

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`missing --${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
  }
  return args[name];
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const host = requireArg(args, 'host');
  const alias = requireArg(args, 'alias');
  const out = requireArg(args, 'out');
  const port = Number(args.port || 22);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('--port must be an integer in range 1-65535');
  }
  if (!/^[a-z0-9_-]{1,64}$/i.test(alias)) {
    throw new Error('--alias must be an HPC alias, not a hostname');
  }
  const types = String(args.types || 'ed25519')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean)
      .join(',');
  if (!types || !/^[a-z0-9,-]+$/i.test(types)) {
    throw new Error('--types contains invalid characters');
  }

  const result = spawnSync('ssh-keyscan', ['-T', '10', '-p', String(port), '-t', types, host], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error([
      'ssh-keyscan failed or returned no host keys',
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }

  const lines = [];
  for (const rawLine of result.stdout.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      continue;
    }
    lines.push(`${alias.toLowerCase()} ${parts[1]} ${parts[2]}`);
  }
  if (lines.length === 0) {
    throw new Error('ssh-keyscan output did not contain parseable public keys');
  }

  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, `${lines.join('\n')}\n`);

  console.log('UNVERIFIED CANDIDATE HOST KEYS');
  console.log('Do not sign a policy with these keys until an operator verifies the fingerprint out of band.');
  console.log(`Wrote candidate known_hosts lines to ${out}`);
  for (const entry of fingerprintsFromKnownHosts(lines.join('\n'), {alias: alias.toLowerCase()})) {
    console.log(`${entry.keyType} ${entry.fingerprint}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
