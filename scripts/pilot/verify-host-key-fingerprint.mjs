#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import {
  fingerprintsFromKnownHosts,
  parseCliArgs,
} from './pilot_lib.mjs';

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.knownHosts) {
    throw new Error('missing --known-hosts');
  }
  if (!args.expectedSha256) {
    throw new Error('missing --expected-sha256');
  }
  if (!/^SHA256:[A-Za-z0-9+/]+$/.test(args.expectedSha256)) {
    throw new Error('--expected-sha256 must be an OpenSSH SHA256 fingerprint');
  }
  const text = fs.readFileSync(args.knownHosts, 'utf8');
  const entries = fingerprintsFromKnownHosts(text, {alias: args.alias});
  if (entries.length === 0) {
    throw new Error('no known_hosts entries matched the requested alias');
  }
  const match = entries.find((entry) => entry.fingerprint === args.expectedSha256);
  if (!match) {
    console.error('Host-key fingerprint mismatch.');
    for (const entry of entries) {
      console.error(`${entry.hostPattern} ${entry.keyType} ${entry.fingerprint}`);
    }
    process.exit(1);
  }
  console.log(`Verified operator-supplied fingerprint ${args.expectedSha256}`);
  console.log(`Matched ${match.hostPattern} ${match.keyType}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
