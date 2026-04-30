#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import {webcrypto} from 'node:crypto';
import {
  base64urlEncode,
  canonicalPolicySigningInput,
} from '../../extension/js/slaif_policy_signature.js';

function parseArgs(argv) {
  const args = {
    algorithm: 'ECDSA-P256-SHA256',
    signedAt: new Date().toISOString(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    args[key] = argv[++index];
  }
  for (const required of ['payload', 'privateKey', 'keyId', 'out']) {
    if (!args[required]) {
      throw new Error(`missing --${required.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
    }
  }
  return args;
}

function decodePrivateKey(filePath, expectedKeyId) {
  const key = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (key.type !== 'slaif.policyPrivateKey' || key.version !== 1) {
    throw new Error('unsupported policy private key file');
  }
  if (key.keyId !== expectedKeyId) {
    throw new Error(`private key keyId mismatch: ${key.keyId}`);
  }
  if (key.algorithm !== 'ECDSA-P256-SHA256') {
    throw new Error(`unsupported private key algorithm: ${key.algorithm}`);
  }
  return Buffer.from(key.privateKeyPkcs8Base64, 'base64');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(fs.readFileSync(args.payload, 'utf8'));
  const privateKeyBytes = decodePrivateKey(args.privateKey, args.keyId);
  const privateKey = await webcrypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      {name: 'ECDSA', namedCurve: 'P-256'},
      false,
      ['sign'],
  );

  const envelope = {
    type: 'slaif.signedHpcPolicy',
    version: 1,
    algorithm: args.algorithm,
    keyId: args.keyId,
    signedAt: args.signedAt,
    payload,
  };
  const bytes = new TextEncoder().encode(canonicalPolicySigningInput(envelope));
  const signature = await webcrypto.subtle.sign(
      {name: 'ECDSA', hash: 'SHA-256'},
      privateKey,
      bytes,
  );
  envelope.signature = base64urlEncode(signature);
  fs.writeFileSync(args.out, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`Signed policy ${payload.policyId || '(unknown policyId)'} as ${args.out}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
