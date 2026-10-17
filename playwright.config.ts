import { defineConfig } from '@playwright/test';

// Browser tests against the local Docker Compose stack (D-M3-11). Local only: not run in CI, not part of
// `npm test`. Start the stack first (`docker compose up -d --build --wait`, `docker compose run --rm seed`).
// The Vite dev server is started here unless it is already running.
export default defineConfig({
  testDir: 'tests/e2e',
  // One database, and tests that stop and start containers: one test at a time, in file order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev -w @docbeam/web',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  outputDir: 'test-results',
});
