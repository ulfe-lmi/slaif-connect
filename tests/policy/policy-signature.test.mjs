import assert from 'node:assert/strict';
import {
  policyFingerprint,
  verifySignedPolicyEnvelope,
} from '../../extension/js/slaif_policy_signature.js';
import {
  makeSigningMaterial,
  signPolicyPayload,
  validPolicyPayload,
} from './policy_test_helpers.mjs';

const material = await makeSigningMaterial();
const envelope = await signPolicyPayload(validPolicyPayload(), material);
assert.equal(
    (await verifySignedPolicyEnvelope(envelope, material.trustRoots)).policyId,
    'slaif-hpc-policy-test',
);
assert.match(await policyFingerprint(envelope), /^[A-Za-z0-9_-]+$/);

const tampered = structuredClone(envelope);
tampered.payload.hosts.vegahpc.sshHost = 'attacker.example';
await assert.rejects(
    () => verifySignedPolicyEnvelope(tampered, material.trustRoots),
    /signature verification failed/,
);

const wrongMaterial = await makeSigningMaterial('other-key');
await assert.rejects(
    () => verifySignedPolicyEnvelope(envelope, wrongMaterial.trustRoots),
    /unknown policy signing key/,
);

await assert.rejects(
    () => verifySignedPolicyEnvelope({...envelope, algorithm: 'none'}, material.trustRoots),
    /unsupported signed policy algorithm/,
);

console.log('policy signature tests OK');
