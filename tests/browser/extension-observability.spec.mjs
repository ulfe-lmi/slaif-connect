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

test.describe('SLAIF observability browser smoke', () => {
  test('emits safe audit events and metrics for a browser SSH launch', async () => {
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
      expect(stack.webApi.jobReports).toHaveLength(1);

      const metricsText = await (await fetch(`${stack.apiBaseUrl}/metrics`)).text();
      expect(metricsText).toContain('slaif_tokens_consumed_total');
      expect(metricsText).toContain('slaif_relay_connections_total');
      expect(metricsText).toContain('slaif_job_reports_total');

      for (const forbidden of [
        stack.launchToken,
        stack.relayToken,
        stack.jobReportToken,
        stack.password,
        stack.expectedOutput,
        'privateKey',
        'OTP',
      ]) {
        expect(metricsText).not.toContain(forbidden);
      }
      expect(metricsText).not.toContain('sessionId=');
      expect(metricsText).not.toContain('tokenFingerprint=');
      expect(metricsText).not.toContain('password=');

      const auditEvents = stack.auditSink.events;
      for (const eventName of [
        'descriptor.issued',
        'relay.auth.accepted',
        'relay.closed',
        'jobReport.accepted',
      ]) {
        expect(auditEvents.some((event) => event.event === eventName)).toBe(true);
      }

      const auditText = JSON.stringify(auditEvents);
      for (const forbidden of [
        stack.launchToken,
        stack.relayToken,
        stack.jobReportToken,
        stack.password,
        stack.expectedOutput,
      ]) {
        expect(auditText).not.toContain(forbidden);
      }
    } finally {
      if (extensionHarness) {
        await extensionHarness.close();
      }
      await stopBrowserRelayDevStack(stack);
    }
  });
});
