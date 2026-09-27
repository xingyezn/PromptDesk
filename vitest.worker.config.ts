import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: 'synthetic-test-secret-with-at-least-32-characters',
          RESEND_API_KEY: 're_test_synthetic_key',
          AUTH_EMAIL_FROM: 'PromptDesk <test@example.test>',
          APP_BASE_URL: 'https://promptdesk-preview.openedutools.workers.dev',
          TEST_MIGRATIONS: await readD1Migrations('./worker/migrations'),
        },
      },
    })),
  ],
  test: {
    include: ['tests/worker/**/*.worker.test.ts'],
    setupFiles: ['./tests/worker/setup.ts'],
  },
});
