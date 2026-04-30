import {webcrypto} from 'node:crypto';
import {
  base64urlEncode,
  canonicalPolicySigningInput,
} from '../../extension/js/slaif_policy_signature.js';

export function validPolicyPayload(overrides = {}) {
  return {
    type: 'slaif.hpcPolicy',
    version: 1,
    policyId: 'slaif-hpc-policy-test',
    sequence: 3,
    validFrom: '2026-04-30T00:00:00.000Z',
    validUntil: '2027-12-31T23:59:59.000Z',
    allowedApiOrigins: ['https://connect.slaif.si'],
    allowedRelayOrigins: ['wss://connect.slaif.si'],
    hosts: {
      vegahpc: {
        displayName: 'Vega HPC',
        sshHost: 'login.vega.example',
        sshPort: 22,
        hostKeyAlias: 'vegahpc',
        knownHosts: ['vegahpc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAplaceholder'],
        remoteCommandTemplate: '/opt/slaif/bin/slaif-launch --session ${SESSION_ID}',
      },
    },
    ...overrides,
  };
}

export async function makeSigningMaterial(keyId = 'slaif-policy-test-key') {
  const keyPair = await webcrypto.subtle.generateKey(
      {name: 'ECDSA', namedCurve: 'P-256'},
      true,
      ['sign', 'verify'],
  );
  const publicSpki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    keyId,
    privateKey: keyPair.privateKey,
    trustRoots: {
      type: 'slaif.policyTrustRoots',
      version: 1,
      keys: [
        {
          keyId,
          algorithm: 'ECDSA-P256-SHA256',
          publicKeySpkiBase64: Buffer.from(publicSpki).toString('base64'),
        },
      ],
    },
  };
}

export async function signPolicyPayload(payload, material) {
  const envelope = {
    type: 'slaif.signedHpcPolicy',
    version: 1,
    algorithm: 'ECDSA-P256-SHA256',
    keyId: material.keyId,
    signedAt: '2026-04-30T12:00:00.000Z',
    payload,
  };
  const signature = await webcrypto.subtle.sign(
      {name: 'ECDSA', hash: 'SHA-256'},
      material.privateKey,
      new TextEncoder().encode(canonicalPolicySigningInput(envelope)),
  );
  envelope.signature = base64urlEncode(signature);
  return envelope;
}
