import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  reporter: 'list',
  use: {
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.KANCHA_CHROMIUM ? { executablePath: process.env.KANCHA_CHROMIUM } : {},
  },
});
