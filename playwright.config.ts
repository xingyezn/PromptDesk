import { defineConfig } from '@playwright/test';
const production = process.env.PROMPTDESK_PRODUCTION === '1';
const basePath = process.env.VITE_BASE_PATH || '/PromptDesk/';
const url = production ? `http://127.0.0.1:4174${basePath}` : 'http://127.0.0.1:5173/';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: url,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: {
    command: production ? 'npm run preview -- --port 4174' : 'npm run dev',
    env: production ? { VITE_BASE_PATH: basePath } : {},
    url,
    reuseExistingServer: !process.env.CI,
  },
});
