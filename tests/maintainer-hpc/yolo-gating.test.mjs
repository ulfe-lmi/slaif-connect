import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const yoloScript = path.join(root, 'maintainer/hpc-test-kit/remote/slaif-hpc-test-yolo.sh');

function runYolo(env = {}) {
  const remoteBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-yolo-test-'));
  const result = spawnSync('bash', [yoloScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REMOTE_BASE_DIR: remoteBaseDir,
      ...env,
    },
  });
  fs.rmSync(remoteBaseDir, {recursive: true, force: true});
  return result;
}

assert.notEqual(runYolo().status, 0);
assert.notEqual(runYolo({SLAIF_ALLOW_YOLO: '1'}).status, 0);
assert.notEqual(runYolo({
  SLAIF_ALLOW_YOLO: '1',
  SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE: '1',
}).status, 0);

const accepted = runYolo({
  SLAIF_ALLOW_YOLO: '1',
  SLAIF_I_UNDERSTAND_THIS_RUNS_ARBITRARY_CODE: '1',
  SLAIF_YOLO_COMMAND: 'echo yolo-ok',
});
assert.equal(accepted.status, 0, accepted.stderr);
assert.match(accepted.stdout, /WARNING/);

console.log('maintainer HPC YOLO gating tests OK');
