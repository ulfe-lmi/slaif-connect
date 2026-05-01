import {expect, test} from '@playwright/test';
import fs from 'node:fs';
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

test.describe('SLAIF Connect SLURM job metadata reporting', () => {
  test('reports parsed SLURM job metadata after fixed remote command completes', async () => {
    const stack = await startBrowserRelayDevStack();
    let extensionHarness = null;

    try {
      const signedPolicy = JSON.parse(fs.readFileSync(stack.signedPolicyPath, 'utf8'));
      expect(signedPolicy.payload.hosts[stack.runtimeConfig.hpc].remoteCommandTemplate)
          .toContain('/keys/slaif-launch --session ${SESSION_ID}');

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
      await expect(sessionPage.locator('#log')).toContainText('Job report sent');

      expect(stack.webApi.jobReports).toHaveLength(1);
      const report = stack.webApi.jobReports[0];
      expect(report).toMatchObject({
        type: 'slaif.jobReport',
        version: 1,
        sessionId: stack.runtimeConfig.sessionId,
        hpc: stack.runtimeConfig.hpc,
        scheduler: 'slurm',
        jobId: stack.runtimeConfig.expectedJobId,
        status: 'submitted',
        sshExitCode: 0,
      });
      for (const forbidden of [
        'stdout',
        'stderr',
        'transcript',
        'password',
        'otp',
        'privateKey',
        'relayToken',
        'launchToken',
        'jobReportToken',
        'workloadToken',
      ]) {
        expect(report).not.toHaveProperty(forbidden);
      }
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });
});
