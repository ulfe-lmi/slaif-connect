import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const remoteDir = path.join(root, 'maintainer/hpc-test-kit/remote');
const localRunner = fs.readFileSync(
    path.join(root, 'maintainer/hpc-test-kit/local/run-maintainer-hpc-test.mjs'),
    'utf8',
);

for (const entry of fs.readdirSync(remoteDir)) {
  if (!entry.endsWith('.sh')) {
    continue;
  }
  const script = fs.readFileSync(path.join(remoteDir, entry), 'utf8');
  assert.match(script, /set -euo pipefail/, `${entry} must use strict mode`);
  assert.equal(/\bsudo\b/.test(script), false, `${entry} must not use sudo`);
  assert.equal(/StrictHostKeyChecking=no/.test(script), false, `${entry} must not disable host-key checking`);
  assert.equal(/\bsshpass\b/.test(script), false, `${entry} must not use sshpass`);
}

assert.equal(/\bsshpass\b/.test(localRunner), false, 'local runner must not use sshpass');
assert.match(localRunner, /StrictHostKeyChecking=yes/, 'local runner must use strict host-key checking');
assert.match(localRunner, /UserKnownHostsFile=/, 'local runner must use an explicit verified known_hosts file');
assert.match(localRunner, /launcher-intent/, 'local runner must expose launcher-intent phase');
assert.match(localRunner, /buildMaintainerSessionIntent/, 'local runner must generate session intent files');
assert.match(localRunner, /buildMaintainerProfileCatalog/, 'local runner must generate Slurm profile files');
assert.equal(/yolo.*launcher-intent/.test(localRunner), false, 'launcher intent path must stay separate from YOLO');

const cpuScript = fs.readFileSync(path.join(remoteDir, 'slaif-hpc-test-cpu.sh'), 'utf8');
const gpuScript = fs.readFileSync(path.join(remoteDir, 'slaif-hpc-test-gpu.sh'), 'utf8');
assert.match(cpuScript, /SLAIF_PAYLOAD_RESULT_BEGIN/, 'CPU maintainer diagnostic must frame payload results');
assert.match(cpuScript, /cpu_payload_result\.json/, 'CPU result bundle should include structured payload result JSON');
assert.match(gpuScript, /SLAIF_PAYLOAD_RESULT_BEGIN/, 'GPU maintainer diagnostic must frame payload results');
assert.match(gpuScript, /gpu_payload_result\.json/, 'GPU result bundle should include structured payload result JSON');
assert.equal(/jobReportToken|workloadToken|privateKey/.test(`${cpuScript}\n${gpuScript}`), false);

console.log('maintainer HPC static script safety tests OK');
