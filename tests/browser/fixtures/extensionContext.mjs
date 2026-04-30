import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {extensionBuildDir} from '../helpers/devStack.mjs';

export async function launchSlaifExtensionContext(options = {}) {
  if (!fs.existsSync(path.join(extensionBuildDir, 'manifest.json'))) {
    throw new Error('build/extension is missing. Run npm run build:extension first.');
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaif-browser-e2e-'));
  const consoleMessages = [];
  const pageErrors = [];

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless ?? true,
    channel: options.channel || 'chromium',
    args: [
      `--disable-extensions-except=${extensionBuildDir}`,
      `--load-extension=${extensionBuildDir}`,
      '--no-sandbox',
    ],
  });

  context.on('page', (page) => {
    attachDiagnostics(page, consoleMessages, pageErrors);
  });
  for (const page of context.pages()) {
    attachDiagnostics(page, consoleMessages, pageErrors);
  }

  const serviceWorker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', {timeout: 30000});
  const extensionId = new URL(serviceWorker.url()).host;
  if (!extensionId) {
    throw new Error(`could not resolve extension id from ${serviceWorker.url()}`);
  }

  async function close() {
    await context.close();
    fs.rmSync(userDataDir, {recursive: true, force: true});
  }

  return {
    context,
    extensionId,
    consoleMessages,
    pageErrors,
    close,
  };
}

function attachDiagnostics(page, consoleMessages, pageErrors) {
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message || String(error));
  });
}
