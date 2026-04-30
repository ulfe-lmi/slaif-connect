import {expect, test} from '@playwright/test';
import {launchSlaifExtensionContext} from './fixtures/extensionContext.mjs';
import {
  startBrowserRelayDevStack,
  stopBrowserRelayDevStack,
} from './helpers/devStack.mjs';
import {
  enterDevPasswordWhenPrompted,
  expectRemoteOutput,
  openDevSessionPage,
} from './helpers/extensionPage.mjs';

test.describe('SLAIF Connect browser OpenSSH/WASM relay prototype', () => {
  test('runs the fixed command through browser-side OpenSSH/WASM and the relay', async () => {
    const stack = await startBrowserRelayDevStack();
    let extensionHarness = null;

    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });
      const page = await openDevSessionPage(extensionHarness);

      await expect(page.locator('body')).toContainText('Relay connected', {timeout: 90000});
      await enterDevPasswordWhenPrompted(page, stack.password);
      await expectRemoteOutput(page, stack.expectedOutput);
      await expect(page.locator('body')).toHaveAttribute('data-slaif-status', 'completed', {
        timeout: 120000,
      });
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });

  test('rejects a changed host key before command execution', async () => {
    const stack = await startBrowserRelayDevStack({wrongKnownHost: true});
    let extensionHarness = null;

    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });
      const page = await openDevSessionPage(extensionHarness);

      await expect(page.locator('#captured-output')).toContainText(
          /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification/i,
          {timeout: 120000},
      );
      await expect(page.locator('#captured-output')).not.toContainText(stack.expectedOutput);
      await expect(page.locator('body')).toHaveAttribute('data-slaif-status', 'failed', {
        timeout: 30000,
      });
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });
});
