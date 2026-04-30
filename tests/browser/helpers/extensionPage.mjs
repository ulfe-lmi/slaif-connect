import {expect} from '@playwright/test';

export async function openDevSessionPage(extensionHarness) {
  const page = await extensionHarness.context.newPage();
  await page.goto(`chrome-extension://${extensionHarness.extensionId}/html/session.html?dev=1`);
  return page;
}

export async function launchFromMockSlaifPage(extensionHarness, launcherUrl) {
  const launcher = await extensionHarness.context.newPage();
  const sessionPagePromise = extensionHarness.context.waitForEvent('page', {
    timeout: 30000,
    predicate: (page) => page.url().includes('/html/session.html'),
  });
  const url = new URL(launcherUrl);
  url.searchParams.set('extensionId', extensionHarness.extensionId);
  await launcher.goto(url.href);
  await launcher.locator('#launch').click();
  await expect(launcher.locator('[data-launch-result]')).toHaveAttribute(
      'data-launch-result',
      'accepted',
      {timeout: 30000},
  );
  const sessionPage = await sessionPagePromise;
  await sessionPage.waitForLoadState('domcontentloaded');
  return {launcher, sessionPage};
}

export async function sendExternalLaunchMessage(page, extensionId, message) {
  return page.evaluate(({extensionId: id, message: payload}) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(id, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ok: false, error: chrome.runtime.lastError.message});
          return;
        }
        resolve(response);
      });
    });
  }, {extensionId, message});
}

export async function waitForStatus(page, status, options = {}) {
  await expect(page.locator('body')).toHaveAttribute('data-slaif-status', status, options);
}

export async function enterDevPasswordWhenPrompted(page, password) {
  const input = page.locator('[data-slaif-secure-input="true"] input').first();
  await expect(input).toBeVisible({timeout: 90000});
  await input.fill(password);
  await input.press('Enter');
}

export async function expectRemoteOutput(page, expectedOutput) {
  await expect(page.locator('#captured-output')).toContainText(expectedOutput, {timeout: 120000});
}
