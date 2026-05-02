import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareLauncherKeysDirectory} from '../../tools/start-extension-dev-stack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const launcher = path.join(root, 'remote/launcher/slaif-launch');

function isExecutable(filePath) {
  return (fs.statSync(filePath).mode & 0o111) !== 0;
}

assert.ok(fs.existsSync(launcher), 'remote launcher should exist');
assert.equal(isExecutable(launcher), true, 'remote launcher should be executable in the working tree');

const gitStage = execFileSync('git', ['ls-files', '--stage', 'remote/launcher/slaif-launch'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
assert.match(gitStage, /^100755 /, 'remote launcher should be tracked with executable git mode 100755');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-launcher-permissions-'));
try {
  const {launcherTarget} = prepareLauncherKeysDirectory({root, tempDir});
  assert.equal(isExecutable(launcherTarget), true, 'generated dev-stack launcher copy should be executable');
  assert.equal((fs.statSync(tempDir).mode & 0o755), 0o755, 'generated /keys mount directory should be traversable');
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true});
}
