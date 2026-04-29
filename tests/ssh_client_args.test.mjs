import assert from 'node:assert/strict';
import {buildSshArgs} from '../extension/js/slaif_ssh_client.js';

const policyHost = {
  sshHost: '127.0.0.1',
  sshPort: 22,
  hostKeyAlias: 'test-sshd',
};

const args = buildSshArgs({
  policyHost,
  username: 'testuser',
  command: 'SESSION_ID=sess_abcdefgh /bin/printf slaif-browser-relay-ok',
});

for (const required of [
  'StrictHostKeyChecking=yes',
  'CheckHostIP=no',
  'HostKeyAlias=test-sshd',
  'ForwardAgent=no',
  'ForwardX11=no',
  'ClearAllForwardings=yes',
]) {
  assert.ok(args.includes(required), `missing SSH option ${required}`);
}

assert.equal(args.includes('StrictHostKeyChecking=no'), false);
assert.equal(args.includes('UserKnownHostsFile=/dev/null'), false);
assert.equal(args.includes('-A'), false);
assert.equal(args.includes('-R'), false);
assert.equal(args.includes('-L'), false);
assert.equal(args.includes('-D'), false);
assert.deepEqual(args.slice(-2), [
  '127.0.0.1',
  'SESSION_ID=sess_abcdefgh /bin/printf slaif-browser-relay-ok',
]);

assert.throws(() => buildSshArgs({
  policyHost,
  username: 'bad user',
  command: 'date',
}), /invalid SSH username/);

console.log('SSH argument tests OK');
