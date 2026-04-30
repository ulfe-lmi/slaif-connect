#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  createPilotPolicyPayload,
  parseCliArgs,
  readJson,
  writeJson,
} from './pilot_lib.mjs';

function required(args, name) {
  if (!args[name]) {
    throw new Error(`missing --${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
  }
  return args[name];
}

function main() {
  const args = parseCliArgs(process.argv.slice(2), {boolean: ['pilotFixedCommand']});
  const input = readJson(required(args, 'input'));
  const out = required(args, 'out');
  const payload = createPilotPolicyPayload(input, {
    policyId: required(args, 'policyId'),
    sequence: required(args, 'sequence'),
    validFrom: required(args, 'validFrom'),
    validUntil: required(args, 'validUntil'),
    pilotFixedCommand: Boolean(args.pilotFixedCommand),
  });
  fs.mkdirSync(path.dirname(out), {recursive: true});
  writeJson(out, payload);
  console.log(`Wrote unsigned pilot policy payload: ${out}`);
  if (payload.hosts[input.alias]?.pilotFixedCommand) {
    console.log('Pilot fixed command mode is enabled for this local/manual pilot policy.');
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
