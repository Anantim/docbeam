import { defineConfig } from '@playwright/test';

// Browser tests against dev on AWS (M4). Not run in CI. Set DEV_APP_URL (the CloudFront address of dev) and
// DEV_SEED_PASSWORD (from Secrets Manager, never written to a file), then `npm run test:e2e:dev`.
// Only the download specs run here: the other specs stop containers and read the local database.
const baseURL = process.env.DEV_APP_URL;
if (!baseURL) throw new Error('Set DEV_APP_URL to the CloudFront address of dev.');

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['download.spec.ts', 'download-dev.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 45_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL, screenshot: 'on', trace: 'off', viewport: { width: 1360, height: 900 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  outputDir: 'test-results',
});
