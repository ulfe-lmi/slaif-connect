import assert from 'node:assert/strict';
import {
  buildResultBundleNextSteps,
  safeBundleSummary,
} from '../../maintainer/hpc-test-kit/local/collect-result-bundle.mjs';

const config = {
  system: 'vega',
  selectedLoginHost: 'login.vega.izum.si',
  remoteBaseDir: '~/.slaif-connect/hpc-tests',
  sshKeyPath: '/home/user/.ssh/id_ed25519',
  verifiedKnownHostsFile: '/home/user/.slaif-connect/vega.verified-known-hosts',
  secretSample: 'do-not-copy-this-secret',
};

const summary = safeBundleSummary(config);
const serializedSummary = JSON.stringify(summary);
assert.equal(serializedSummary.includes('id_ed25519'), false);
assert.equal(serializedSummary.includes('verified-known-hosts'), false);
assert.equal(serializedSummary.includes('do-not-copy-this-secret'), false);
assert.equal(summary.includesSecrets, false);

const nextSteps = buildResultBundleNextSteps(config);
assert.match(nextSteps, /verified host-key fingerprint/);
assert.match(nextSteps, /CPU diagnostic job ID/);
assert.match(nextSteps, /GPU diagnostic job ID/);
assert.match(nextSteps, /launcher dry-run result/);
assert.equal(nextSteps.includes('id_ed25519'), false);

console.log('maintainer HPC result bundle tests OK');
