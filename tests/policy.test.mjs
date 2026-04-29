import assert from 'node:assert/strict';
import {
  buildRemoteCommand,
  requireKnownHpcAlias,
  validateAlias,
  validatePolicy,
  validateSessionId,
} from '../extension/js/slaif_policy.js';

const policy = {
  relay: {
    url: 'wss://connect.slaif.si/ssh-relay',
  },
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
};

validatePolicy(policy);
assert.equal(validateAlias('VegaHPC'), 'vegahpc');
assert.equal(validateSessionId('sess_abcdefgh'), 'sess_abcdefgh');
assert.equal(requireKnownHpcAlias(policy, 'VEGAHPC').sshHost, 'login.vega.example');
assert.equal(
    buildRemoteCommand(policy.hosts.vegahpc, 'sess_abcdefgh'),
    '/opt/slaif/bin/slaif-launch --session sess_abcdefgh',
);

for (const bad of [
  'sess_short',
  'sess_bad value',
  'sess_bad;value',
  'sess_bad$value',
  'sess_bad/value',
  'sess_bad"value',
]) {
  assert.throws(() => validateSessionId(bad), /invalid SLAIF session id/);
}

assert.throws(() => requireKnownHpcAlias(policy, 'example.com'), /unknown|invalid/);

const badTemplatePolicy = structuredClone(policy);
badTemplatePolicy.hosts.vegahpc.remoteCommandTemplate = '/opt/slaif/bin/run ${SESSION_ID}\nwhoami';
assert.throws(() => validatePolicy(badTemplatePolicy), /control characters/);

console.log('policy tests OK');
