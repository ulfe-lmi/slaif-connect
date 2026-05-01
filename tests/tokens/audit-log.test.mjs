import assert from 'node:assert/strict';
import {createAuditLogger, sanitizeEvent} from '../../server/logging/audit_log.js';

const token = 'slaif_tok_this-full-token-must-not-appear';
const sanitized = sanitizeEvent({
  relayToken: token,
  tokenFingerprint: 'sha256:abc123ef45678900',
  launchToken: token,
  jobReportToken: token,
  password: 'secret',
  payload: Buffer.from('ssh bytes'),
  stdout: 'terminal output',
  sessionId: 'sess_audit_test_123',
  hpc: 'test-sshd',
});

const serialized = JSON.stringify(sanitized);
assert.equal(serialized.includes(token), false);
assert.equal(serialized.includes('secret'), false);
assert.equal(serialized.includes('terminal output'), false);
assert.equal(sanitized.sessionId, 'sess_audit_test_123');
assert.equal(sanitized.hpc, 'test-sshd');
assert.equal(sanitized.tokenFingerprint, 'sha256:abc123ef45678900');
assert.equal(sanitized.relayToken.redacted, true);
assert.match(sanitized.relayToken.fingerprint, /^sha256:[0-9a-f]{16}$/);

const events = [];
const logger = createAuditLogger({
  clock: () => new Date('2026-04-30T12:00:00.000Z'),
  logger: {
    info(line) {
      events.push(JSON.parse(line));
    },
  },
});
const event = logger.event('relay.auth_rejected', {
  relayToken: token,
  errorCode: 'wrong_scope',
});
assert.equal(events.length, 1);
assert.equal(events[0].type, 'slaif.auditEvent');
assert.equal(events[0].event, 'relay.auth_rejected');
assert.equal(events[0].timestamp, '2026-04-30T12:00:00.000Z');
assert.equal(JSON.stringify(events[0]).includes(token), false);
assert.deepEqual(event, events[0]);

console.log('audit log tests OK');
