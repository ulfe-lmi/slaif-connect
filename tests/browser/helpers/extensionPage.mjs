import {expect} from '@playwright/test';

export async function openDevSessionPage(extensionHarness) {
  const page = await extensionHarness.context.newPage();
  await page.goto(`chrome-extension://${extensionHarness.extensionId}/html/session.html?dev=1`);
  return page;
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
