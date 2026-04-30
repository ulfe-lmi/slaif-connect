import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  validatePilotInput,
} from '../../scripts/pilot/pilot_lib.mjs';

function keyBody(seed = 'pilot-input') {
  return Buffer.from(crypto.createHash('sha256').update(seed).digest()).toString('base64');
}

function validInput(overrides = {}) {
  return {
    type: 'slaif.hpcPilotInput',
    version: 1,
    alias: 'examplehpc',
    displayName: 'Example HPC',
    sshHost: 'login.example.edu',
    sshPort: 22,
    hostKeyAlias: 'examplehpc',
    verifiedKnownHosts: [
      `examplehpc ssh-ed25519 ${keyBody()}`,
    ],
    allowedApiOrigins: ['http://127.0.0.1:18180'],
    allowedRelayOrigins: ['ws://127.0.0.1:18181'],
    remoteCommandTemplate: '/opt/slaif/bin/slaif-launch --session ${SESSION_ID}',
    ...overrides,
  };
}

assert.equal(validatePilotInput(validInput()).alias, 'examplehpc');
assert.equal(validatePilotInput(validInput({
  verifiedKnownHosts: [`@cert-authority examplehpc ssh-ed25519 ${keyBody('host-ca')}`],
})).alias, 'examplehpc');
assert.throws(() => validatePilotInput(validInput({verifiedKnownHosts: []})), /verifiedKnownHosts/);
assert.throws(() => validatePilotInput(validInput({hostKeyAlias: 'otherhpc'})), /hostKeyAlias/);
assert.throws(() => validatePilotInput(validInput({sshHost: 'ssh://login.example.edu'})), /hostname/);
assert.throws(() => validatePilotInput(validInput({sshPort: 0})), /sshPort/);
assert.throws(() => validatePilotInput(validInput({
  remoteCommandTemplate: '/bin/printf slaif-pilot-ok',
})), /SESSION_ID/);
assert.equal(validatePilotInput(validInput({
  remoteCommandTemplate: '/bin/printf slaif-pilot-ok',
}), {pilotFixedCommand: true}).alias, 'examplehpc');

for (const field of [
  'password',
  'otp',
  'privateKey',
  'sshOptions',
  'StrictHostKeyChecking',
  'commandFromWeb',
  'allowArbitraryCommand',
]) {
  assert.throws(() => validatePilotInput(validInput({[field]: 'forbidden'})), /forbidden field/);
}

console.log('pilot input validation tests OK');
