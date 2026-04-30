#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {webcrypto} from 'node:crypto';

function parseArgs(argv) {
  const args = {
    keyId: 'slaif-policy-dev-2026-04',
    privateKeyOut: 'dist/policy/slaif-policy-dev-private-key.json',
    trustRootsOut: 'extension/config/policy_trust_roots.local.json',
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      args.force = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
      args[key] = argv[++index];
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return args;
}

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const filePath of [args.privateKeyOut, args.trustRootsOut]) {
    if (fs.existsSync(filePath) && !args.force) {
      throw new Error(`${filePath} already exists; pass --force to overwrite`);
    }
  }

  const keyPair = await webcrypto.subtle.generateKey(
      {name: 'ECDSA', namedCurve: 'P-256'},
      true,
      ['sign', 'verify'],
  );
  const privatePkcs8 = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicSpki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);

  const privateKey = {
    type: 'slaif.policyPrivateKey',
    version: 1,
    keyId: args.keyId,
    algorithm: 'ECDSA-P256-SHA256',
    privateKeyPkcs8Base64: base64(privatePkcs8),
  };
  const trustRoots = {
    type: 'slaif.policyTrustRoots',
    version: 1,
    keys: [
      {
        keyId: args.keyId,
        algorithm: 'ECDSA-P256-SHA256',
        publicKeySpkiBase64: base64(publicSpki),
      },
    ],
  };

  fs.mkdirSync(path.dirname(args.privateKeyOut), {recursive: true});
  fs.mkdirSync(path.dirname(args.trustRootsOut), {recursive: true});
  fs.writeFileSync(args.privateKeyOut, `${JSON.stringify(privateKey, null, 2)}\n`, {mode: 0o600});
  fs.writeFileSync(args.trustRootsOut, `${JSON.stringify(trustRoots, null, 2)}\n`);

  console.log(`Wrote development private key: ${args.privateKeyOut}`);
  console.log(`Wrote development trust roots: ${args.trustRootsOut}`);
  console.log('Do not commit private signing keys.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
