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

async function expectPolicyFailure(stackOptions, pattern) {
  const stack = await startBrowserRelayDevStack(stackOptions);
  let extensionHarness = null;

  try {
    extensionHarness = await launchSlaifExtensionContext({
      headless: process.env.SLAIF_BROWSER_HEADED !== '1',
    });
    const page = await openDevSessionPage(extensionHarness);
    await expect(page.locator('body')).toHaveAttribute('data-slaif-status', 'failed', {
      timeout: 60000,
    });
    await expect(page.locator('#log')).toContainText(pattern);
    await expect(page.locator('#captured-output')).not.toContainText(stack.expectedOutput);
  } finally {
    if (extensionHarness) {
      await extensionHarness.close();
    }
    await stopBrowserRelayDevStack(stack);
  }
}

test.describe('SLAIF Connect signed HPC policy enforcement', () => {
  test('uses a generated signed local-dev policy for browser SSH', async () => {
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

  test('rejects a tampered signed policy', async () => {
    await expectPolicyFailure({tamperSignedPolicy: true}, /signature verification failed/i);
  });

  test('rejects a signed policy from an unknown signer', async () => {
    await expectPolicyFailure({wrongPolicySigner: true}, /unknown policy signing key/i);
  });

  test('rejects an expired signed policy', async () => {
    await expectPolicyFailure({expiredPolicy: true}, /expired/i);
  });

  test('rejects a relay origin outside signed policy', async () => {
    await expectPolicyFailure({relayOriginMismatch: true}, /relay origin is not allowed/i);
  });
});
