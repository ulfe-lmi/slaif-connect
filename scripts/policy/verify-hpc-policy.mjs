#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import {validatePolicy} from '../../extension/js/slaif_policy.js';
import {
  policyFingerprint,
  verifySignedPolicyEnvelope,
} from '../../extension/js/slaif_policy_signature.js';

function parseArgs(argv) {
  const args = {
    policy: 'extension/config/hpc_policy.signed.example.json',
    trustRoots: 'extension/config/policy_trust_roots.example.json',
    allowLocalDev: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-local-dev') {
      args.allowLocalDev = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
      args[key] = argv[++index];
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envelope = JSON.parse(fs.readFileSync(args.policy, 'utf8'));
  const trustRoots = JSON.parse(fs.readFileSync(args.trustRoots, 'utf8'));
  const payload = await verifySignedPolicyEnvelope(envelope, trustRoots);
  validatePolicy(payload, {allowLocalDev: args.allowLocalDev});
  const fingerprint = await policyFingerprint(envelope);
  console.log(`Policy: ${payload.policyId}`);
  console.log(`Sequence: ${payload.sequence}`);
  console.log(`Key ID: ${envelope.keyId}`);
  console.log(`Valid: ${payload.validFrom} to ${payload.validUntil}`);
  console.log(`Hosts: ${Object.keys(payload.hosts).sort().join(', ')}`);
  console.log(`Fingerprint: ${fingerprint}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
