import { defineConfig } from '@playwright/test';
const external = process.env.PROMPTDESK_CLOUD_URL || process.env.PROMPTDESK_AUTH_SMOKE_URL;
const url = external || 'http://127.0.0.1:8789/';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['cloud*.spec.ts', 'live-auth.spec.ts'],
  timeout: 120000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: url,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    ...(process.env.PROMPTDESK_TEST_PROXY
      ? { proxy: { server: process.env.PROMPTDESK_TEST_PROXY } }
      : {}),
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  ...(external
    ? {}
    : {
        webServer: {
          command: 'node scripts/dev-cloud.mjs',
          timeout: 120000,
          url,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
