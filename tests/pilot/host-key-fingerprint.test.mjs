import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  fingerprintFromPublicKeyBody,
  fingerprintsFromKnownHosts,
} from '../../scripts/pilot/pilot_lib.mjs';

const keyBody = crypto.randomBytes(48).toString('base64');
const line = `examplehpc ssh-ed25519 ${keyBody}`;
const expected = fingerprintFromPublicKeyBody(keyBody);
const entries = fingerprintsFromKnownHosts(`${line}\n`, {alias: 'examplehpc'});

assert.equal(entries.length, 1);
assert.equal(entries[0].fingerprint, expected);
assert.equal(fingerprintsFromKnownHosts(`${line}\n`, {alias: 'otherhpc'}).length, 0);
assert.notEqual(expected, `SHA256:${crypto.randomBytes(32).toString('base64').replace(/=+$/, '')}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-pilot-fingerprint-'));
try {
  const knownHostsPath = path.join(tempDir, 'known_hosts');
  fs.writeFileSync(knownHostsPath, `${line}\n`);
  const ok = spawnSync('node', [
    'scripts/pilot/verify-host-key-fingerprint.mjs',
    '--known-hosts', knownHostsPath,
    '--expected-sha256', expected,
    '--alias', 'examplehpc',
  ], {encoding: 'utf8'});
  assert.equal(ok.status, 0, ok.stderr);

  const mismatch = spawnSync('node', [
    'scripts/pilot/verify-host-key-fingerprint.mjs',
    '--known-hosts', knownHostsPath,
    '--expected-sha256', `SHA256:${crypto.randomBytes(32).toString('base64').replace(/=+$/, '')}`,
    '--alias', 'examplehpc',
  ], {encoding: 'utf8'});
  assert.notEqual(mismatch.status, 0);
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true});
}

console.log('host-key fingerprint tests OK');
