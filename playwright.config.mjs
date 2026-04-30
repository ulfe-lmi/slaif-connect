import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 180000,
  // Browser extension tests share one generated unpacked extension directory.
  // Run serially so each dev stack owns dev_runtime.local.json while active.
  workers: 1,
  expect: {
    timeout: 30000,
  },
  reporter: process.env.CI ? [['dot'], ['html', {open: 'never'}]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
