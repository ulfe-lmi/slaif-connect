import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAuditLogger,
  makeAuditEvent,
  sanitizeEvent,
} from '../../server/logging/audit_log.js';
import {
  AuditSinkError,
  createExternalAuditSink,
  createFileAuditSink,
  createMemoryAuditSink,
} from '../../server/logging/audit_sink.js';

const token = 'slaif_tok_observability-secret-token';
const secretPayload = 'SSH_PAYLOAD_MUST_NOT_APPEAR';
const event = makeAuditEvent({
  event: 'relay.auth.accepted',
  requestId: 'req_test',
  sessionId: 'sess_observability_123',
  hpc: 'test-sshd',
  scope: 'slaif.relay',
  relayToken: token,
  payload: secretPayload,
  outcome: 'accepted',
}, {
  clock: () => new Date('2026-04-30T12:00:00.000Z'),
  environment: 'test',
});

assert.equal(event.type, 'slaif.auditEvent');
assert.equal(event.version, 1);
assert.equal(event.event, 'relay.auth.accepted');
assert.equal(event.timestamp, '2026-04-30T12:00:00.000Z');
assert.equal(event.sessionId, 'sess_observability_123');
assert.equal(event.relayToken.redacted, true);
assert.match(event.relayToken.fingerprint, /^sha256:[0-9a-f]{16}$/);
assert.equal(JSON.stringify(event).includes(token), false);
assert.equal(JSON.stringify(event).includes(secretPayload), false);

const withoutSession = makeAuditEvent({
  event: 'descriptor.issued',
  sessionId: 'sess_should_not_log',
}, {includeSessionId: false});
assert.equal(Object.hasOwn(withoutSession, 'sessionId'), false);

const sanitized = sanitizeEvent({
  authorization: `Bearer ${token}`,
  stdout: 'Submitted batch job 424242',
  tokenFingerprint: 'sha256:abc123ef45678900',
});
assert.equal(JSON.stringify(sanitized).includes(token), false);
assert.equal(JSON.stringify(sanitized).includes('Submitted batch job'), false);
assert.equal(sanitized.tokenFingerprint, 'sha256:abc123ef45678900');

const memorySink = createMemoryAuditSink();
const logger = createAuditLogger({
  sink: memorySink,
  clock: () => new Date('2026-04-30T12:00:00.000Z'),
  environment: 'test',
});
logger.event('token.consumed', {
  token,
  scope: 'slaif.launch',
  outcome: 'accepted',
});
assert.equal(memorySink.events.length, 1);
assert.equal(memorySink.events[0].event, 'token.consumed');
assert.equal(JSON.stringify(memorySink.events).includes(token), false);
assert.equal(memorySink.healthCheck().ok, true);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-audit-test-'));
const auditPath = path.join(tempDir, 'audit.jsonl');
const fileSink = createFileAuditSink({filePath: auditPath});
fileSink.write(event);
await fileSink.close();
const fileText = fs.readFileSync(auditPath, 'utf8');
assert.equal(fileText.includes(token), false);
assert.equal(JSON.parse(fileText.trim()).event, 'relay.auth.accepted');
fs.rmSync(tempDir, {recursive: true, force: true});

assert.throws(() => createExternalAuditSink(), (error) => {
  assert(error instanceof AuditSinkError);
  assert.equal(error.code, 'audit_sink_not_implemented');
  return true;
});

console.log('audit sink tests OK');
