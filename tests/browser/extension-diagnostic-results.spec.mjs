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
} from './helpers/extensionPage.mjs';

async function runDiagnosticLaunch(payloadId) {
  const stack = await startBrowserRelayDevStack({payloadId});
  let extensionHarness = null;
  try {
    extensionHarness = await launchSlaifExtensionContext({
      headless: process.env.SLAIF_BROWSER_HEADED !== '1',
    });
    const {sessionPage} = await launchFromMockSlaifPage(extensionHarness, stack.launcherUrl);
    await expect(sessionPage.locator('body')).toContainText('Relay connected', {timeout: 90000});
    await enterDevPasswordWhenPrompted(sessionPage, stack.password);
    await expectRemoteOutput(sessionPage, stack.expectedOutput);
    await expect(sessionPage.locator('body')).toHaveAttribute('data-slaif-status', 'completed', {
      timeout: 120000,
    });
    await expect(sessionPage.locator('#log')).toContainText('Payload result sent');
    return {stack, extensionHarness};
  } catch (error) {
    if (extensionHarness) {
      await extensionHarness.close();
    }
    await stopBrowserRelayDevStack(stack);
    throw error;
  }
}

test.describe('SLAIF Connect diagnostic payload result reporting', () => {
  test('reports CPU diagnostic structured payload result through browser SSH path', async () => {
    const {stack, extensionHarness} = await runDiagnosticLaunch('cpu_memory_diagnostics_v1');
    try {
      expect(stack.webApi.payloadResults).toHaveLength(1);
      const payloadResult = stack.webApi.payloadResults[0];
      expect(payloadResult).toMatchObject({
        type: 'slaif.payloadResult',
        version: 1,
        sessionId: stack.runtimeConfig.sessionId,
        hpc: stack.runtimeConfig.hpc,
        payloadId: 'cpu_memory_diagnostics_v1',
        scheduler: 'slurm',
        jobId: stack.runtimeConfig.expectedJobId,
        status: 'completed',
      });
      expect(payloadResult.result.cpuCount).toBeGreaterThan(0);
      expect(stack.webApi.jobReports).toHaveLength(1);
      for (const forbidden of [
        'stdout',
        'stderr',
        'transcript',
        'password',
        'otp',
        'privateKey',
        'launchToken',
        'relayToken',
        'jobReportToken',
        'workloadToken',
        'command',
        'scriptText',
      ]) {
        expect(JSON.stringify(payloadResult)).not.toContain(forbidden);
      }
    } finally {
      await extensionHarness.close();
      await stopBrowserRelayDevStack(stack);
    }
  });

  test('reports GPU diagnostic no-GPU structured payload result through browser SSH path', async () => {
    const {stack, extensionHarness} = await runDiagnosticLaunch('gpu_diagnostics_v1');
    try {
      expect(stack.webApi.payloadResults).toHaveLength(1);
      const payloadResult = stack.webApi.payloadResults[0];
      expect(payloadResult).toMatchObject({
        type: 'slaif.payloadResult',
        payloadId: 'gpu_diagnostics_v1',
        scheduler: 'slurm',
        jobId: stack.runtimeConfig.expectedJobId,
        status: 'no_gpu_detected',
      });
      expect(payloadResult.result.gpus).toEqual([]);
      expect(payloadResult.result.gpuAvailable).toBe(false);
      expect(JSON.stringify(payloadResult)).not.toContain('transcript');
      expect(JSON.stringify(payloadResult)).not.toContain('jobReportToken');
    } finally {
      await extensionHarness.close();
      await stopBrowserRelayDevStack(stack);
    }
  });
});
