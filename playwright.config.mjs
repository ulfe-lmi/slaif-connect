import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 180000,
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
