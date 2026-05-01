import {expect, test} from '@playwright/test';
import {WebSocket} from 'ws';
import {TOKEN_SCOPES} from '../../server/tokens/token_registry.js';
import {launchSlaifExtensionContext} from './fixtures/extensionContext.mjs';
import {
  startBrowserRelayDevStack,
  stopBrowserRelayDevStack,
} from './helpers/devStack.mjs';
import {
  enterDevPasswordWhenPrompted,
  expectRemoteOutput,
  launchFromMockSlaifPage,
} from './helpers/extensionPage.mjs';

async function expectRelayReplayRejected(stack) {
  const ws = new WebSocket(stack.runtimeConfig.relayUrl, ['slaif-ssh-relay-v1']);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({
    type: 'auth',
    relayToken: stack.relayToken,
  }));
  const close = await new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({code, reason: reason.toString()}));
  });
  expect(close.reason).toBe('token_use_exceeded');
}

async function runSuccessfulLaunch(stack) {
  const extensionHarness = await launchSlaifExtensionContext({
    headless: process.env.SLAIF_BROWSER_HEADED !== '1',
  });
  try {
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
    return {extensionHarness, sessionPage};
  } catch (error) {
    await extensionHarness.close();
    throw error;
  }
}

test.describe('SLAIF token lifecycle browser validation', () => {
  test('uses scoped launch, relay, and reporting tokens for a successful session', async () => {
    const stack = await startBrowserRelayDevStack();
    let extensionHarness = null;
    try {
      ({extensionHarness} = await runSuccessfulLaunch(stack));

      expect(stack.webApi.jobReports).toHaveLength(1);
      await expectRelayReplayRejected(stack);

      const descriptorReplay = await fetch(`${stack.apiBaseUrl}/api/test/descriptor-replay`, {
        headers: {
          Authorization: `Bearer ${stack.launchToken}`,
        },
      });
      expect(descriptorReplay.status).toBe(401);

      const jobReportReplay = await fetch(`${stack.apiBaseUrl}/api/test/job-report-replay`, {
        headers: {
          Authorization: `Bearer ${stack.jobReportToken}`,
        },
      });
      expect(jobReportReplay.status).toBe(401);
      expect(stack.webApi.jobReports).toHaveLength(1);
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });

  test('rejects an expired relay token before SSH starts', async () => {
    const stack = await startBrowserRelayDevStack({expiredRelayTokenDescriptor: true});
    let extensionHarness = null;
    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });
      const {sessionPage} = await launchFromMockSlaifPage(
          extensionHarness,
          stack.launcherUrl,
      );
      await expect(sessionPage.locator('body')).toHaveAttribute('data-slaif-status', 'failed', {
        timeout: 30000,
      });
      await expect(sessionPage.locator('#log')).toContainText('relayToken has expired');
      await expect(sessionPage.locator('#captured-output')).not.toContainText(stack.expectedOutput);
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });

  test('rejects a wrong-scope relay token', async () => {
    const stack = await startBrowserRelayDevStack({relayTokenScope: TOKEN_SCOPES.LAUNCH});
    let extensionHarness = null;
    try {
      extensionHarness = await launchSlaifExtensionContext({
        headless: process.env.SLAIF_BROWSER_HEADED !== '1',
      });
      const {sessionPage} = await launchFromMockSlaifPage(
          extensionHarness,
          stack.launcherUrl,
      );
      await expect(sessionPage.locator('body')).toHaveAttribute('data-slaif-status', 'failed', {
        timeout: 90000,
      });
      await expect(sessionPage.locator('#captured-output')).not.toContainText(stack.expectedOutput);
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });
});
