import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validatePolicy} from '../../extension/js/slaif_policy.js';
import {
  createPilotPolicyPayload,
} from '../../scripts/pilot/pilot_lib.mjs';

function keyBody(seed = 'pilot-policy') {
  return Buffer.from(crypto.createHash('sha256').update(seed).digest()).toString('base64');
}

const input = {
  type: 'slaif.hpcPilotInput',
  version: 1,
  alias: 'examplehpc',
  displayName: 'Example HPC',
  sshHost: 'login.example.edu',
  sshPort: 22,
  hostKeyAlias: 'examplehpc',
  verifiedKnownHosts: [`examplehpc ssh-ed25519 ${keyBody()}`],
  allowedApiOrigins: ['http://127.0.0.1:18180'],
  allowedRelayOrigins: ['ws://127.0.0.1:18181'],
  remoteCommandTemplate: '/bin/printf slaif-pilot-ok',
};

const payload = createPilotPolicyPayload(input, {
  policyId: 'slaif-hpc-policy-pilot',
  sequence: 1,
  validFrom: '2026-04-30T00:00:00.000Z',
  validUntil: '2026-05-31T23:59:59.000Z',
  pilotFixedCommand: true,
});
assert.equal(payload.hosts.examplehpc.sshHost, 'login.example.edu');
assert.equal(payload.hosts.examplehpc.pilotFixedCommand, true);
validatePolicy(payload, {allowLocalDev: true, now: new Date('2026-05-01T00:00:00.000Z')});
const productionLikeFixedCommandPayload = {
  ...payload,
  allowedApiOrigins: ['https://connect.slaif.si'],
  allowedRelayOrigins: ['wss://connect.slaif.si'],
};
assert.throws(() => validatePolicy(productionLikeFixedCommandPayload, {
  now: new Date('2026-05-01T00:00:00.000Z'),
}), /SESSION_ID/);

assert.throws(() => createPilotPolicyPayload({...input, verifiedKnownHosts: []}, {
  policyId: 'slaif-hpc-policy-pilot',
  sequence: 1,
  validFrom: '2026-04-30T00:00:00.000Z',
  validUntil: '2026-05-31T23:59:59.000Z',
  pilotFixedCommand: true,
}), /verifiedKnownHosts/);

console.log('pilot policy creation tests OK');
