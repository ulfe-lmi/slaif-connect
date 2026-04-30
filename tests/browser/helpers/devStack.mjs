import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  startExtensionDevStack,
  stopExtensionDevStack,
} from '../../../tools/start-extension-dev-stack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '../../..');
export const extensionBuildDir = path.join(repoRoot, 'build/extension');

export async function startBrowserRelayDevStack(options = {}) {
  return startExtensionDevStack({
    root: repoRoot,
    buildDir: extensionBuildDir,
    quiet: true,
    ...options,
  });
}

export async function stopBrowserRelayDevStack(stack) {
  await stopExtensionDevStack(stack);
}
