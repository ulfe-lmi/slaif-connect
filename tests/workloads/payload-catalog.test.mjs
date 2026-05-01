import assert from 'node:assert/strict';
import {
  buildDefaultPayloadCatalog,
  resolveAllowedPayload,
  validateHostPayloadRefs,
  validatePayloadCatalog,
  validatePayloadId,
} from '../../server/workloads/payload_catalog.js';

function catalog(overrides = {}) {
  return {
    ...buildDefaultPayloadCatalog(),
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    allowedPayloads: catalog(overrides.allowedPayloads || {}),
    hosts: {
      vegahpc: {
        allowedPayloadIds: [
          'gpu_diagnostics_v1',
          'cpu_memory_diagnostics_v1',
          'gams_chat_v1',
        ],
        ...(overrides.host || {}),
      },
    },
  };
}

validatePayloadCatalog(catalog());
validateHostPayloadRefs(policy().hosts.vegahpc, policy().allowedPayloads, {alias: 'vegahpc'});
assert.equal(resolveAllowedPayload(policy(), 'vegahpc', 'gpu_diagnostics_v1').payload.type, 'fast_diagnostic');
assert.equal(resolveAllowedPayload(policy(), 'vegahpc', 'gams_chat_v1').payload.type, 'interactive_llm');

for (const payloadId of [
  'unknown_payload_v1',
  'gpu diagnostics',
  'gpu_diagnostics_v1;rm',
  'curl_attacker',
  '../gpu_diagnostics_v1',
]) {
  assert.throws(() => validatePayloadId(payloadId), /payloadId/);
}

for (const field of [
  'command',
  'shellCommand',
  'remoteCommand',
  'sshCommand',
  'script',
  'scriptText',
  'jobScript',
  'password',
  'otp',
  'privateKey',
  'token',
  'workloadToken',
  'relayToken',
]) {
  assert.throws(() => validatePayloadCatalog(catalog({
    gpu_diagnostics_v1: {
      ...catalog().gpu_diagnostics_v1,
      [field]: 'forbidden',
    },
  })), /must not include|forbidden/i);
}

assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    maxRuntimeSeconds: undefined,
  },
})), /maxRuntimeSeconds/);
assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    maxRuntimeSeconds: 3601,
  },
})), /maxRuntimeSeconds/);
assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    maxOutputBytes: undefined,
  },
})), /maxOutputBytes/);
assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    maxOutputBytes: 1048577,
  },
})), /maxOutputBytes/);
assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    resultSchema: undefined,
  },
})), /resultSchema/);
assert.throws(() => validatePayloadCatalog(catalog({
  gpu_diagnostics_v1: {
    ...catalog().gpu_diagnostics_v1,
    requiresGpu: 'yes',
  },
})), /requiresGpu/);

validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    model: 'cjvt/GaMS3-12B-Instruct',
    runtime: 'vllm',
  },
}));
assert.throws(() => validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    model: 'unknown-model',
  },
})), /model/);
assert.throws(() => validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    runtime: 'unknown-runtime',
  },
})), /runtime/);
assert.throws(() => validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    requiresOutboundWorkloadConnection: false,
  },
})), /outbound/);
assert.throws(() => validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    maxPromptBytes: 262145,
  },
})), /maxPromptBytes/);
assert.throws(() => validatePayloadCatalog(catalog({
  gams_chat_v1: {
    ...catalog().gams_chat_v1,
    maxOutputTokens: 32769,
  },
})), /maxOutputTokens/);

assert.throws(() => validateHostPayloadRefs(
    {allowedPayloadIds: ['missing_payload_v1']},
    catalog(),
    {alias: 'vegahpc'},
), /payloadId|missing/);
assert.throws(() => validateHostPayloadRefs(
    {allowedPayloadIds: []},
    catalog(),
    {alias: 'vegahpc'},
), /allowedPayloadIds/);
assert.throws(() => resolveAllowedPayload(
    policy({host: {allowedPayloadIds: ['gpu_diagnostics_v1']}}),
    'vegahpc',
    'gams_chat_v1',
), /not allowed/);

console.log('payload catalog tests OK');
